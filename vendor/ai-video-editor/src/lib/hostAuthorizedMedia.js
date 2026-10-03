import { isExportAbortError, throwIfExportAborted } from "./exportCancellation.js";

export function resolveAuthorizedProjectMediaSource(url, kind, authorizedAssets = []) {
  if (typeof url !== "string" || !url || typeof kind !== "string" || !kind) return null;
  return authorizedAssets.find((asset) => (
    asset
    && asset.url === url
    && asset.kind === kind
    && typeof asset.assetId === "string"
    && typeof asset.versionId === "string"
  )) || null;
}

export async function loadAuthorizedProjectMediaBlob(
  url,
  kind,
  authorizedAssets = [],
  fetchImpl = fetch,
) {
  if (!resolveAuthorizedProjectMediaSource(url, kind, authorizedAssets)) {
    throw new Error("project-media-not-authorized");
  }
  const response = await fetchImpl(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`project-media-load-failed:${response.status}`);
  return response.blob();
}

function resolveAuthorizedSegmentSource(segment, kind, authorizedAssets = []) {
  const assetId = typeof segment?.assetId === "string" ? segment.assetId : "";
  const versionId = typeof segment?.assetVersionId === "string" ? segment.assetVersionId : "";
  const sourceUrl = typeof segment?.sourceUrl === "string" ? segment.sourceUrl : "";
  let source = null;

  if (versionId) {
    source = authorizedAssets.find((asset) => asset?.kind === kind && asset.versionId === versionId) || null;
    if (!source) {
      if (assetId && authorizedAssets.some((asset) => asset?.kind === kind && asset.assetId === assetId)) {
        throw new Error("project-media-version-mismatch");
      }
      throw new Error("project-media-not-authorized");
    }
    if (assetId && source.assetId !== assetId) throw new Error("project-media-asset-mismatch");
    return source;
  }

  if (assetId) {
    source = authorizedAssets.find((asset) => asset?.kind === kind && asset.assetId === assetId) || null;
    if (!source) {
      if (resolveAuthorizedProjectMediaSource(sourceUrl, kind, authorizedAssets)) {
        throw new Error("project-media-asset-mismatch");
      }
      throw new Error("project-media-not-authorized");
    }
    return source;
  }

  source = resolveAuthorizedProjectMediaSource(sourceUrl, kind, authorizedAssets);
  if (!source) throw new Error("project-media-not-authorized");
  return source;
}

/**
 * The authorized AssetVersion an audio-lane segment plays from, or null when
 * the segment names none of them. A segment that names one the host did not
 * authorize throws, exactly as restoring it does — naming is the gate, and it
 * is the same gate whether the caller wants the URL or the bytes.
 */
export function resolveAuthorizedAudioSegmentSource(segment, authorizedAssets = []) {
  const hasIdentity = typeof segment?.assetId === "string" || typeof segment?.assetVersionId === "string";
  const hasUrl = typeof segment?.sourceUrl === "string" && segment.sourceUrl;
  if (!hasIdentity && !hasUrl) return null;
  const kind = segment.sourceKind === "video" ? "video" : "audio";
  return resolveAuthorizedSegmentSource(segment, kind, authorizedAssets);
}

export function restoreAuthorizedAudioSegmentSource(segment, authorizedAssets = []) {
  const source = resolveAuthorizedAudioSegmentSource(segment, authorizedAssets);
  if (!source) return null;
  return {
    ...segment,
    assetId: source.assetId,
    assetVersionId: source.versionId,
    sourceUrl: source.url,
    url: source.url,
    peaks: [],
  };
}

/**
 * The audio-lane segments, each carrying the bytes it plays.
 *
 * A clip the HOST placed is restored as a SOURCE — `url`, `sourceUrl` and the
 * AssetVersion it belongs to — because that is all the editor needs to play
 * it. The browser export mixes Blobs, so someone has to read the file, and
 * this is where: at the export, not at the import. A cut is opened far more
 * often than it is exported, and its voice track is one clip per line — the
 * music bed is fetched on import because there is exactly one of it.
 *
 * The gate is unchanged: a clip is fetched only once its own assetId /
 * assetVersionId / sourceUrl names something in `authorizedAssets`, and each
 * AssetVersion is read once however many clips were cut from it. A clip that
 * names nothing authorized, or whose bytes will not come, is returned exactly
 * as it arrived — what a voice clip without media means for an export is the
 * caller's rule, not this function's.
 *
 * `extractVideoAudio` is how a clip cut from a VIDEO AssetVersion becomes
 * audio. Without it such a clip is left alone rather than handed a video file
 * to decode as if it were a sound.
 */
export async function loadAuthorizedAudioSegmentMedia(
  segments = [],
  authorizedAssets = [],
  { fetchImpl = fetch, extractVideoAudio = null, onProgress, signal } = {},
) {
  // Keyed by the URL, which is the file: two versions of one asset are two
  // files and two reads, and a list entry with no URL to read is no key at
  // all rather than a key every skipped clip would match.
  const urlBySegment = new Map();
  const wanted = new Map();
  segments.forEach((segment) => {
    if (!segment || segment.blob instanceof Blob) return;
    let source = null;
    try {
      source = resolveAuthorizedAudioSegmentSource(segment, authorizedAssets);
    } catch (error) {
      console.warn("Host-authorized audio segment unresolved", segment.id, error);
      return;
    }
    if (typeof source?.url !== "string" || !source.url) return;
    urlBySegment.set(segment, source.url);
    if (!wanted.has(source.url)) wanted.set(source.url, source);
  });
  if (!wanted.size) return segments;

  const loaded = new Map();
  const total = wanted.size;
  let read = 0;
  for (const [url, source] of wanted) {
    throwIfExportAborted(signal);
    read += 1;
    onProgress?.({ current: read, total });
    try {
      const response = await fetchImpl(url, { credentials: "same-origin", ...(signal ? { signal } : {}) });
      if (!response.ok) throw new Error(`project-media-load-failed:${response.status}`);
      const file = await response.blob();
      const blob = source.kind === "video"
        ? extractVideoAudio && await extractVideoAudio(file, source.name || "source-video.mp4")
        : file;
      if (blob instanceof Blob) loaded.set(url, blob);
    } catch (error) {
      if (isExportAbortError(error)) throw error;
      console.warn("Host-authorized audio media unavailable", url, error);
    }
  }
  throwIfExportAborted(signal);

  // A copy per clip, and only for the export that asked. These never reach
  // editor state, so a cut whose voices were fetched to render it is the same
  // cut afterwards — nothing to autosave, nothing to a revision.
  return segments.map((segment) => {
    const blob = loaded.get(urlBySegment.get(segment));
    return blob ? { ...segment, blob } : segment;
  });
}

export function restoreAuthorizedVisualSegmentSource(segment, authorizedAssets = []) {
  const hasIdentity = typeof segment?.assetId === "string" || typeof segment?.assetVersionId === "string";
  const hasUrl = typeof segment?.sourceUrl === "string" && segment.sourceUrl;
  if (!hasIdentity && !hasUrl) return null;
  const kind = segment.type === "video" ? "video" : "image";
  const source = resolveAuthorizedSegmentSource(segment, kind, authorizedAssets);
  return {
    ...segment,
    assetId: source.assetId,
    assetVersionId: source.versionId,
    sourceUrl: source.url,
    src: source.url,
  };
}

/** Seconds when `value` is a finite positive number, else undefined. */
export function measuredSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export function hostMediaMeta(kind, duration) {
  if (kind === "video") return `VibeDev · ${duration > 0 ? `${duration.toFixed(1)}s` : "视频"}`;
  if (kind === "audio") return `VibeDev · ${duration > 0 ? `${duration.toFixed(1)}s` : "音频"}`;
  return "VibeDev · 图片";
}

/**
 * Duration fields to spread over `asset` once the host reports `seconds`
 * for it. A duration the editor already measured wins; a project file or
 * pending upload carries the placeholder 0, and placing it with that
 * placeholder falls back to the image default (a 6 s clip became 4 s).
 */
export function adoptMeasuredDuration(asset, seconds) {
  const measured = measuredSeconds(seconds);
  if (measured === undefined || measuredSeconds(asset?.duration) !== undefined) return {};
  return { duration: measured, meta: hostMediaMeta(asset?.type, measured) };
}

export function authorizedAssetToUserAsset(asset) {
  if (!asset?.assetId || !asset?.versionId || !asset?.url || !asset?.kind) return null;
  const duration = Number.isFinite(Number(asset.durationSeconds))
    ? Math.max(0, Number(asset.durationSeconds))
    : asset.kind === "image" ? 4 : 0;
  return {
    id: `vibedev-${asset.versionId}`,
    // Every spelling, so a consumer reading hostVersionId (timeline placement)
    // and one reading assetVersionId (merging) agree on this asset.
    assetId: asset.assetId,
    versionId: asset.versionId,
    assetVersionId: asset.versionId,
    hostAssetId: asset.assetId,
    hostVersionId: asset.versionId,
    hostUrl: asset.url,
    type: asset.kind,
    src: asset.url,
    sourceUrl: asset.url,
    name: asset.name || asset.versionId,
    mimeType: asset.mimeType || "application/octet-stream",
    duration,
    width: 0,
    height: 0,
    trackFrames: [],
    meta: hostMediaMeta(asset.kind, duration),
    hostAuthorized: true,
  };
}

export function projectFileToUserAsset(file) {
  if (!file?.id || !file?.path || !file?.url || !file?.kind) return null;
  const duration = file.kind === "image" ? 4 : 0;
  return {
    id: file.id,
    type: file.kind,
    src: file.url,
    sourceUrl: file.url,
    name: file.name || file.path,
    mimeType: file.mimeType || "application/octet-stream",
    ...(Number.isFinite(Number(file.sizeBytes)) ? { size: Number(file.sizeBytes) } : {}),
    ...(Number.isFinite(Number(file.mtime)) ? { mtime: Number(file.mtime) } : {}),
    duration,
    width: 0,
    height: 0,
    trackFrames: [],
    meta: "VibeDev · 项目文件",
    hostProjectFile: true,
    projectFileId: file.id,
    projectFilePath: file.path,
    requiresPin: true,
  };
}

export function mergeProjectFileUserAssets(current = [], projectFiles = []) {
  // The project scan is a browse feed, not another copy of a generated asset.
  // Match only host-authorized sources, including the project in the exact URL.
  const alreadyAuthorized = (file) => current.some((asset) => asset?.hostAuthorized
    && hostVersionIdOf(asset) && asset.type === file?.kind && asset.sourceUrl === file?.url);
  const byId = new Map(projectFiles
    .filter((file) => file?.id)
    .map((file) => [file.id, file]));
  const retained = current.flatMap((asset) => {
    if (!asset?.hostProjectFile) return [asset];
    const file = byId.get(asset.projectFileId || asset.id);
    if (!file) return [];
    if (!hostVersionIdOf(asset) && alreadyAuthorized(file)) return [];
    const next = projectFileToUserAsset(file);
    if (!next) return [];
    // Preserve a durable identity after a lazy pin; only the source metadata
    // comes from the latest project-file scan.
    return [{ ...next, ...asset, src: asset.assetVersionId ? asset.src : next.src,
      sourceUrl: asset.assetVersionId ? asset.sourceUrl : next.sourceUrl,
      requiresPin: !asset.assetVersionId && !asset.versionId }];
  });
  const retainedIds = new Set(retained.map((asset) => asset.id));
  const added = projectFiles
    .filter((file) => !alreadyAuthorized(file))
    .map(projectFileToUserAsset)
    .filter((asset) => asset && !retainedIds.has(asset.id));
  return [...added, ...retained];
}

/**
 * The host AssetVersion this asset already belongs to, under any spelling the
 * editor uses for it, or "" when it belongs to none.
 *
 * There are three spellings in the tree and they were not interchangeable:
 * merging keyed on `assetVersionId`/`versionId`, while the generators record a
 * persisted result as `hostAssetId`/`hostVersionId` (AI music, voice) because
 * the timeline placement code reads THOSE. So a generated clip that the host
 * had already stored matched nothing, and the host's copy of the same bytes was
 * added as a second card on the next asset refresh — one labelled by the
 * generator ("AI music · 12.0s"), one by `hostMediaMeta` ("VibeDev · 音频").
 * Field report 2026-09-03, reproduced for video on Windows as
 * "VibeDev · 视频" beside "VibeDev · 8.4s", which is the same duplicate seen
 * through the two branches of that one label function.
 *
 * Reading every spelling here is what makes the identity single: a producer
 * cannot reintroduce the duplicate by picking the other field name.
 */
export function hostVersionIdOf(asset) {
  return asset?.assetVersionId || asset?.versionId || asset?.hostVersionId || "";
}

/**
 * Stamp one host identity onto an asset under EVERY spelling, so whichever
 * field a consumer reads it sees the same AssetVersion. `mergeAuthorizedUserAssets`
 * matches on it, `audioTrackActions` / `useVoiceGeneration` place with it.
 */
export function withHostIdentity(asset, authorized) {
  return {
    ...asset,
    assetId: authorized.assetId,
    assetVersionId: authorized.versionId,
    versionId: authorized.versionId,
    hostAssetId: authorized.assetId,
    hostVersionId: authorized.versionId,
    ...(authorized.url ? { hostUrl: authorized.url } : {}),
  };
}

export function mergeAuthorizedUserAssets(current = [], authorizedAssets = []) {
  const authorizedByVersion = new Map(authorizedAssets
    .filter((asset) => asset?.versionId)
    .map((asset) => [asset.versionId, asset]));
  const matchedVersions = new Set();
  const retained = current.flatMap((asset) => {
    const existingVersion = hostVersionIdOf(asset);
    // A scanned file may arrive before its generation receipt. Promote that
    // card only when the host explicitly authorizes the very same URL/kind.
    // Never infer a version for ordinary uploads or override a pinned version.
    const authorized = existingVersion ? authorizedByVersion.get(existingVersion)
      : asset?.hostProjectFile ? authorizedAssets.find((candidate) => !candidate.supersededVersion
        && candidate.kind === asset.type && candidate.url === asset.sourceUrl) : null;
    const versionId = authorized?.versionId;
    if (authorized) {
      if (!existingVersion && current.some((candidate) => hostVersionIdOf(candidate) === versionId)) return [];
      if (matchedVersions.has(versionId)) return [];
      matchedVersions.add(versionId);
      return [{
        ...withHostIdentity(asset, authorized),
        hostProjectFile: false,
        requiresPin: false,
        // The editor renders from these fields, not only sourceUrl. A
        // historical project can retain a revoked blob URL here after the
        // host has reauthorized the current AssetVersion.
        src: authorized.url,
        sourceUrl: authorized.url,
        ...(Object.prototype.hasOwnProperty.call(asset, "originalSrc")
          ? { originalSrc: authorized.url }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(asset, "previewSrc")
          ? { previewSrc: authorized.url }
          : {}),
        ...adoptMeasuredDuration(asset, authorized.durationSeconds),
        hostAuthorized: true,
        }];
    }
    return asset?.hostAuthorized ? [] : [asset];
  });
  // A superseded version stays AUTHORIZED (a clip pinned to it must still
  // resolve) but earns no card of its own: the library shows one card per
  // asset. Without this an asset with two versions rendered two cards, both
  // labelled by hostMediaMeta — "VibeDev · 视频" for the version whose duration
  // was never measured beside "VibeDev · 8.4s" for the current one.
  const hostAssets = [...authorizedByVersion.values()]
    .filter((asset) => !matchedVersions.has(asset?.versionId) && !asset?.supersededVersion)
    .map(authorizedAssetToUserAsset)
    .filter(Boolean);
  return [...hostAssets, ...retained];
}

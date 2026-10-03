import { resolveAuthorizedAudioSegmentSource } from "./hostAuthorizedMedia.js";
import { isHostRefresh } from "./hostImportPreservation.js";

/**
 * The source-audio lane, restored from a host document.
 *
 * Its two neighbours already survive a host import because each records where
 * its sound came from: a voice clip carries assetId / assetVersionId /
 * sourceUrl and is restored per clip, and the music bed carries a source URL
 * the import loads through `loadAuthorizedProjectMediaBlob`. The source lane
 * recorded a name, a duration, a start and an assetId — nothing that names an
 * entry in the authorized list — so a host import had no way to bring it back
 * and fell through to `clearSourceAudioTrack("")`, which the next autosave
 * wrote over the stored cut.
 *
 * The lane now records its origin under `sourceAudioSource`, in the exact shape
 * `resolveAuthorizedAudioSegmentSource` reads, so the same gate that guards
 * every other host medium guards this one: bytes are read only once the lane
 * names an AssetVersion the host authorized for this project.
 *
 * The origin is the AssetVersion the sound was cut from, which is usually a
 * VIDEO — the lane holds the audio FFmpeg extracted from it. So restoring means
 * reading that file and extracting again, and an origin is recorded only for
 * audio that is the AssetVersion's own sound: a vocal stem or an appended
 * collection of several clips is not, and restoring the whole original in its
 * place would silently change the cut.
 */

/**
 * The lane's origin in the shape the authorized-asset helpers take, or null
 * when the lane names none — an unsaved temporary preview has no host identity. Formal processing
 * outputs obtain their identity from the host before timeline placement.
 */
export function sourceAudioIdentity(source) {
  const assetId = typeof source?.assetId === "string" ? source.assetId : "";
  const assetVersionId = typeof source?.assetVersionId === "string" ? source.assetVersionId : "";
  const sourceUrl = typeof source?.sourceUrl === "string" ? source.sourceUrl : "";
  if (!assetId && !assetVersionId && !sourceUrl) return null;
  return {
    assetId,
    assetVersionId,
    sourceUrl,
    ...(source?.original ? { original: { ...source.original, original: undefined } } : {}),
    // Only a lane that says "video" asks for an extraction; everything else is
    // taken as the sound it already is.
    sourceKind: source?.sourceKind === "video" ? "video" : "audio",
  };
}

/** Whether a document claims a source-audio lane at all. */
export function documentNamesSourceAudio(project) {
  return Boolean(
    (typeof project?.sourceAudioName === "string" && project.sourceAudioName)
    || Number(project?.sourceAudioDuration) > 0
    || sourceAudioIdentity(project?.sourceAudioSource),
  );
}

/**
 * Whether the lane the editor holds is the one the document names.
 *
 * Two lanes without an origin are not "the same lane" — nothing identifies
 * them — so this is true only when both sides name the same AssetVersion.
 */
export function holdsHostSourceAudio(project, held) {
  if (!(held?.blob instanceof Blob)) return false;
  const wanted = sourceAudioIdentity(project?.sourceAudioSource);
  const mine = sourceAudioIdentity(held.source);
  if (!wanted || !mine) return false;
  return wanted.assetId === mine.assetId
    && wanted.assetVersionId === mine.assetVersionId
    && wanted.sourceUrl === mine.sourceUrl
    && wanted.sourceKind === mine.sourceKind;
}

/**
 * What a host import should do with the source-audio lane.
 *
 * `restore` the bytes are in hand — the archive carried them, or the authorized
 *           origin was read back
 * `clear`   the document names no lane; a deletion is still a deletion, and it
 *           is the one case where taking the lane away is what was asked for.
 *           Opening a project FILE always lands here when no bytes came: the
 *           package is self-contained, so an archive without source audio is a
 *           cut without a source lane, and the person asked for that content
 *           wholesale. Only a HOST document is partial — its media lives in the
 *           project rather than in the file it is handed over as
 * `keep`    the document names a lane, the bytes did not come, and the editor
 *           holds one: a refresh must never take away what the host could not
 *           itself supply. This is the live loss — the editor's own save of the
 *           lane round-trips through the daemon and comes back looking like a
 *           host change, so an unrelated agent edit wiped the person's track
 * `record`  the document names a lane, the bytes did not come and the editor
 *           holds nothing — a first open. Writing the document's own record
 *           back is what stops the 450ms autosave from saving the loss over the
 *           stored cut, so the lane can still come back the day its origin is
 *           authorized again
 */
export function hostSourceAudioAction(project, held, blob, importContext) {
  if (blob instanceof Blob) return "restore";
  if (!isHostRefresh(importContext)) return "clear";
  if (!documentNamesSourceAudio(project)) return "clear";
  return held?.blob instanceof Blob ? "keep" : "record";
}

/**
 * The sound of the lane's origin, or null when the lane names none, names one
 * the host did not authorize, or the bytes will not come.
 *
 * Null rather than a throw for every one of those: a superseded take or an
 * asset the host stopped authorizing is an ordinary thing, and the cut still
 * has to open. The caller keeps the document's record instead, so the lane can
 * come back the day the origin is authorized again.
 */
export async function loadHostSourceAudioBlob(
  source,
  authorizedAssets = [],
  { fetchImpl = fetch, extractVideoAudio = null } = {},
) {
  const identity = sourceAudioIdentity(source);
  if (!identity) return null;
  let origin = null;
  try {
    origin = resolveAuthorizedAudioSegmentSource(identity, authorizedAssets);
  } catch (error) {
    console.warn("Host source audio unresolved", identity.sourceUrl, error);
    return null;
  }
  if (typeof origin?.url !== "string" || !origin.url) return null;
  try {
    const response = await fetchImpl(origin.url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`project-media-load-failed:${response.status}`);
    const file = await response.blob();
    if (origin.kind !== "video") return file;
    const sound = extractVideoAudio
      ? await extractVideoAudio(file, origin.name || "source-video.mp4")
      : null;
    return sound instanceof Blob ? sound : null;
  } catch (error) {
    console.warn("Host source audio unavailable", origin.url, error);
    return null;
  }
}

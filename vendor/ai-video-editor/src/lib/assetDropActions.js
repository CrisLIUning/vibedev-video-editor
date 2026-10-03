import { decodeWaveform } from "./media.js";
import { getRemoteAssetBlob, isFetchableAssetSource } from "./remoteAssetCache.js";
import { isAssetReadyForTimeline } from "./assetDragControls.js";
import { adoptMeasuredDuration, measuredSeconds, withHostIdentity } from "./hostAuthorizedMedia.js";

const VIDEO_DURATION_PROBE_TIMEOUT_MS = 8000;

/**
 * Length of a video the host could not measure (no ffprobe, an unparsable
 * container, a version imported before durations were recorded), read
 * off the media itself. A failed read must never become a four-second video.
 */
function readVideoDurationFromSource(src) {
  if (!src || typeof document === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      try { video.removeAttribute("src"); } catch { /* ignore */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), VIDEO_DURATION_PROBE_TIMEOUT_MS);
    video.muted = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(measuredSeconds(video.duration));
    video.onerror = () => finish(undefined);
    video.src = src;
  });
}

export function resolvePendingVisualAssetId(pendingSegment, asset) {
  return pendingSegment?.assetId || asset?.assetId || asset?.id || "";
}

export function createAssetDropActions(d) {
  const tr = (key, fallback) => d.t?.(key, fallback) ?? fallback;
  async function pinProjectFileIfNeeded(asset) {
    if (!asset?.hostProjectFile || asset.assetVersionId || asset.versionId) return asset;
    if (typeof d.capabilityRuntime?.pinProjectFile !== "function") {
      d.notify(tr("assetPinning", "素材正在保存到项目，请稍候"));
      return null;
    }
    try {
      d.notify(tr("assetPinning", "素材正在保存到项目，请稍候"));
      const pinned = await d.capabilityRuntime.pinProjectFile({
        localAssetId: asset.id,
        projectFileId: asset.projectFileId || asset.id,
        path: asset.projectFilePath,
        kind: asset.type,
        name: asset.name,
      });
      const identity = {
        ...withHostIdentity({}, pinned),
        sourceUrl: pinned.url,
        src: pinned.url,
        requiresPin: false,
        hostAuthorized: true,
        // The host measures the version while pinning; a project file only
        // carries the placeholder 0 until then.
        ...adoptMeasuredDuration(asset, pinned.durationSeconds),
      };
      d.onProjectFilePinned?.(asset.id, pinned);
      return { ...asset, ...identity };
    } catch (error) {
      console.warn("Unable to pin project media as a host AssetVersion", error);
      d.notify(tr("assetPinFailed", "项目媒体保存失败，请稍后重试"));
      return null;
    }
  }
  async function resolveRemoteAsset(asset, onProgress) {
    if (!asset?.src || asset.blob || !isFetchableAssetSource(asset)) return asset;
    try {
      d.notify(tr("remoteAssetDownloading", "正在下载在线素材…"));
      const blob = await getRemoteAssetBlob(asset, (progress) => {
        d.onRemoteAssetProgress?.(asset.id, progress);
        onProgress?.(progress);
      });
      if (!blob) throw new Error("Missing remote asset");
      const src = URL.createObjectURL(blob);
      d.imageUrlRefs?.current?.add(src);
      return {
        ...asset,
        src,
        blob,
        remoteSrc: asset.src,
        sourceUrl: asset.sourceUrl || asset.src,
        assetVersionId: asset.assetVersionId || asset.versionId || "",
      };
    } catch {
      d.notify(tr("remoteAssetDownloadFailed", "在线素材下载失败，请稍后重试或打开来源页下载"));
      return null;
    }
  }

  async function applyAssetToTrack(asset, track, options = {}) {
    asset = await pinProjectFileIfNeeded(asset);
    if (!asset) return;
    if (!isAssetReadyForTimeline(asset)) {
      d.notify(tr("assetPinning", "素材正在保存到项目，请稍候"));
      return;
    }
    if (asset?.type === "audio" && asset.kind === "music") track = "music";
    if (!d.canDropAssetOnTrack(asset, track)) {
      d.notify(tr("assetTrackMismatch", "请把素材拖到匹配的轨道"));
      return;
    }
    const isRemoteMedia = !asset?.blob && isFetchableAssetSource(asset);
    const isRemoteVisual = (track === "image" || track === "overlay") && isRemoteMedia;
    let pendingSegment = null;
    let progressBucket = -1;
    const needsDuration = asset.type === "video" && measuredSeconds(asset.duration) === undefined;
    if (needsDuration) d.notify(tr("videoDurationPreparing", "正在读取视频时长，完成后加入时间线…"));
    if (isRemoteVisual && track === "image" && !needsDuration) {
      pendingSegment = d.appendVisualAssetToTimeline({ ...asset, preparing: true, prepareProgress: 0 }, { message: tr("remoteAssetPreparing", "在线素材正在准备") });
      d.onFirstVisualDropped?.();
    }
    asset = await resolveRemoteAsset(asset, pendingSegment ? (progress) => {
      const bucket = Math.round(Math.max(0, Math.min(1, progress || 0)) * 20) / 20;
      if (bucket === progressBucket) return;
      progressBucket = bucket;
      d.setVisualSegments((segments) => segments.map((segment) => segment.id === pendingSegment.id ? { ...segment, prepareProgress: bucket } : segment));
    } : undefined);
    if (!asset) {
      if (pendingSegment) {
        const current = d.visualSegmentsRef?.current ?? d.visualSegments ?? [];
        if (current.some((segment) => segment.id !== pendingSegment.id)) d.setVisualSegments((segments) => segments.filter((segment) => segment.id !== pendingSegment.id));
        else d.clearImageTrack?.(tr("remoteAssetRemovedAfterFailure", "在线素材下载失败，已移除临时片段"));
      }
      return;
    }
    if (asset.type === "video" && measuredSeconds(asset.duration) === undefined) {
      const probe = typeof d.readVideoDuration === "function" ? d.readVideoDuration : readVideoDurationFromSource;
      const probed = await probe(asset.src).catch(() => undefined);
      asset = { ...asset, ...adoptMeasuredDuration(asset, probed) };
      if (measuredSeconds(asset.duration) === undefined) {
        d.notify(tr("videoDurationReadFailed", "无法读取视频时长，尚未加入时间线，请重试或重新上传"));
        return;
      }
    }
    // Keep metadata on the library item too: subsequent drops and host-list
    // refreshes must not start again from the unknown-duration placeholder.
    if (asset.type === "video") d.setUserAssets?.((items) => items.map((item) =>
      item.id === asset.id ? { ...item, ...adoptMeasuredDuration(item, asset.duration) } : item));
    d.setSelectedLibraryAssetId(asset.id);
    if (track === "sticker") {
      d.addStickerAssetToTimeline(asset, options);
      return;
    }
    if (track === "image") {
      if (pendingSegment) {
        const pendingAssetId = resolvePendingVisualAssetId(pendingSegment, asset);
        d.updateVisualAssetInTimeline(pendingAssetId, { ...asset, preparing: false, prepareProgress: 1 });
        // The source-keyed backfill owns video thumbnails, including retries
        // and stale-source checks, for both manual and Agent placements.
      } else {
        d.appendVisualAssetToTimeline(asset);
        d.onFirstVisualDropped?.();
      }
      return;
    }
    if (track === "overlay") {
      d.addVisualOverlay?.(asset, options);
      d.onFirstVisualDropped?.();
      return;
    }
    if (track === "music") {
      await d.selectAsset(asset, { focusAudio: false });
      return;
    }
    if (track === "audio") {
      if (!asset.blob) {
        d.notify(tr("audioAssetUnavailable", "当前音频素材不可用，请重新上传"));
        return;
      }
      const hasValidDuration = Number.isFinite(Number(asset.duration)) && Number(asset.duration) > 0;
      const decoded = asset.peaks?.length && hasValidDuration
        ? { duration: Number(asset.duration), peaks: asset.peaks }
        : await decodeWaveform(asset.blob, 96);
      const dropStart = Number.isFinite(Number(options.startTime))
        ? Number(options.startTime)
        : Number.isFinite(Number(options.percent)) && Number.isFinite(Number(d.timelineDuration))
          ? Math.max(0, Number(options.percent) / 100 * Number(d.timelineDuration))
          : undefined;
      d.replaceAudio(asset.blob, decoded.duration, decoded.peaks, "音频已写入配音轨", {
        sourceKind: asset.hostAuthorized ? "host-asset" : "upload",
        assetId: asset.assetId || asset.id,
        assetVersionId: asset.assetVersionId || asset.versionId || "",
        sourceUrl: asset.sourceUrl || asset.remoteSrc || "",
        name: asset.name,
        start: dropStart,
      });
      d.setSelectedTrack("audio");
      d.notify(tr("audioDroppedOnVoiceTrack", "音频已拖入配音音频轨"));
      return;
    }
    if (track === "source") {
      d.setSelectedTrack("source");
      d.setActiveTool("audio");
      await d.extractVideoSourceAudio(asset);
    }
  }

  function handleTrackAssetDrop(event, track) {
    const asset = d.getDraggedAsset(event);
    let targetTrack = asset?.type === "sticker" ? "sticker" : track;
    if (!d.canDropAssetOnTrack(asset, targetTrack)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = targetTrack === "sticker"
      ? d.trackScrollRef.current?.getBoundingClientRect() ??
        event.currentTarget.getBoundingClientRect()
      : event.currentTarget.getBoundingClientRect();
    const percent = d.getTimelineDropPercent(event.clientX, rect);
    d.draggedAssetIdRef.current = "";
    d.setDraggedAssetId("");
    d.setAssetDropTargetTrack("");
    d.setAssetDropPosition({ track: "", percent: 50 });
    d.triggerAssetDropPulse(targetTrack);
    const startTime = Number.isFinite(Number(event.currentTarget.dataset.dropStartTime)) ? Number(event.currentTarget.dataset.dropStartTime) : undefined;
    const layer = Number.isFinite(Number(event.currentTarget.dataset.dropLayer)) ? Number(event.currentTarget.dataset.dropLayer) : undefined;
    void applyAssetToTrack(asset, targetTrack, { percent, startTime, layer });
  }

  function handleVisualStyleDrop(event) {
    const payload = event.dataTransfer?.getData("application/x-timeline-visual-style") || "";
    const [kind, styleId] = payload.split(":");
    if (!styleId || (kind !== "effect" && kind !== "transition")) {
      handleTrackAssetDrop(event, "image");
      return;
    }
    const clip = event.target.closest?.("[data-timeline-segment-id]");
    const segmentId = clip?.dataset.timelineSegmentId;
    if (!segmentId) {
      d.notify("请将效果或转场拖到具体的画面片段上");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    d.setVisualSegments((segments) => segments.map((segment) =>
      segment.id === segmentId
        ? { ...segment, [kind === "effect" ? "filterId" : "transitionId"]: styleId }
        : segment,
    ));
    d.setSelectedVisualSegmentId(segmentId);
    d.setSelectedTrack("image");
    if (kind === "effect") d.setSelectedFilterId(styleId);
    else d.setSelectedTransitionId(styleId);
    d.notify(kind === "effect" ? "效果已应用到该画面片段" : "转场已绑定到该片段的结尾");
  }

  return { applyAssetToTrack, handleTrackAssetDrop, handleVisualStyleDrop };
}

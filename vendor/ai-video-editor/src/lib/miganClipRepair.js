import { encodePngFrameSequence } from "./media.js";
import { repairMiganFrame } from "./miganRepair.js";

function abortError() {
  const error = new Error("AI repair canceled");
  error.name = "AbortError";
  return error;
}

function waitFor(video, eventName, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", canceled);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Could not read the video")); };
    const canceled = () => { cleanup(); reject(abortError()); };
    video.addEventListener(eventName, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", canceled, { once: true });
  });
}

async function loadVideo(src, signal) {
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = src; video.load();
  if (video.readyState < 1) await waitFor(video, "loadedmetadata", signal);
  if (video.readyState < 2) await waitFor(video, "loadeddata", signal);
  return video;
}

async function seek(video, time, signal) {
  if (signal?.aborted) throw abortError();
  const target = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), time));
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.0005) return;
  const waiting = waitFor(video, "seeked", signal);
  video.currentTime = target;
  await waiting;
}

function canvasBlobFromVideo(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not capture video frame")),
    "image/png",
  ));
}

const REPAIR_ENCODING_PHASES = {
  remasterPhaseLoadEncoder: "repairPhaseLoadEncoder",
  remasterPhaseEncodeVideo: "repairPhaseEncodeVideo",
  remasterPhaseCreateAsset: "repairPhaseCreateAsset",
};

export async function repairMiganClip({
  segment,
  selection,
  regions = null,
  videoElement = null,
  frameRate = 25,
  rangeIn = 0,
  rangeOut = null,
  signal,
  onProgress,
  onFrame,
  modelArtifacts,
}) {
  if (segment?.type !== "video" || !segment.src) throw new Error("Select a video clip first");
  const expectedSrc = new URL(segment.src, window.location.href).href;
  const reusable = videoElement?.readyState >= 2
    && videoElement.videoWidth > 0
    && (videoElement.currentSrc === expectedSrc || videoElement.src === expectedSrc);
  const video = reusable ? videoElement : await loadVideo(segment.src, signal);
  const restoreTime = reusable ? video.currentTime : 0;
  const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
  const sourceDuration = Math.max(0.001, Math.min(
    (Number(video.duration) || 0) - sourceStart,
    Number(segment.sourceDuration) || Number(segment.duration) || Number(video.duration) || 0.001,
  ));
  const playbackRate = Math.max(0.25, Number(segment.playbackRate) || 1);
  const safeRate = Math.max(1, Math.min(30, Math.round(frameRate || 25)));
  const totalFrames = Math.max(1, Math.ceil(sourceDuration * safeRate));
  const applyStart = Math.max(0, Number(rangeIn) || 0) * playbackRate;
  const applyEnd = Math.min(sourceDuration, Number.isFinite(rangeOut) ? rangeOut * playbackRate : sourceDuration);
  const repairRegions = Array.isArray(regions) && regions.length
    ? regions
    : [{ start: applyStart / playbackRate, end: applyEnd / playbackRate, selection }];

  const resolveSelection = (region, timelineTime) => {
    const frames = Array.isArray(region.keyframes) ? region.keyframes : [];
    if (!frames.length) return region.selection;
    if (timelineTime <= frames[0].time) return frames[0].selection;
    if (timelineTime >= frames.at(-1).time) return frames.at(-1).selection;
    const nextIndex = frames.findIndex((frame) => frame.time >= timelineTime);
    const before = frames[nextIndex - 1];
    const after = frames[nextIndex];
    const mix = (timelineTime - before.time) / Math.max(0.001, after.time - before.time);
    return Object.fromEntries(["x", "y", "width", "height"].map((key) => [
      key,
      before.selection[key] + (after.selection[key] - before.selection[key]) * mix,
    ]));
  };
  let backend = "";
  const reportProgress = (progress) => onProgress?.({
    ...progress,
    phaseKey: REPAIR_ENCODING_PHASES[progress.phaseKey] || progress.phaseKey,
  });
  const reportCompletedFrame = (index) => reportProgress({
    progress: Math.min(90, 2 + ((index + 1) / totalFrames) * 88),
    phaseKey: "repairPhaseFrame",
    frameIndex: index + 1,
    totalFrames,
    backend,
  });
  try {
    let sourceBlob = segment.blob;
    if (!(sourceBlob instanceof Blob)) {
      const response = await fetch(segment.src);
      if (response.ok) sourceBlob = await response.blob();
    }
    const blob = await encodePngFrameSequence({
      totalFrames,
      frameRate: safeRate,
      signal,
      audioSourceBlob: sourceBlob,
      audioStart: sourceStart,
      audioDuration: sourceDuration,
      onProgress: reportProgress,
      produceFrame: async (index) => {
        const localSourceTime = index / safeRate;
        await seek(video, sourceStart + localSourceTime, signal);
        const timelineTime = localSourceTime / playbackRate;
        const activeRegions = repairRegions.filter((region) => timelineTime >= Number(region.start || 0) && timelineTime <= Number(region.end ?? sourceDuration));
        if (!activeRegions.length) {
          const originalFrame = await canvasBlobFromVideo(video);
          await onFrame?.({ blob: originalFrame, index, totalFrames, time: timelineTime, repaired: false });
          reportCompletedFrame(index);
          return originalFrame;
        }
        let bitmap = await createImageBitmap(video);
        let result = null;
        for (const region of activeRegions) {
          result = await repairMiganFrame({
            bitmap,
            selection: resolveSelection(region, timelineTime),
            signal,
            onProgress: (message) => {
              backend = message.backend || backend;
              reportProgress({
                progress: Math.min(90, 2 + (index / totalFrames) * 88),
                phaseKey: message.stage === "download" ? "repairPhaseDownload" : message.stage === "compile" ? "repairPhaseCompile" : "repairPhaseFrame",
                frameIndex: index + 1, totalFrames, backend,
              });
            },
            modelArtifacts,
          });
          backend = result.backend || backend;
          bitmap.close?.();
          bitmap = await createImageBitmap(result.blob);
        }
        bitmap.close?.();
        await onFrame?.({ blob: result.blob, index, totalFrames, time: timelineTime, repaired: true });
        reportCompletedFrame(index);
        return result.blob;
      },
    });
    return { blob, width: video.videoWidth, height: video.videoHeight, sourceDuration, frameRate: safeRate, totalFrames, backend };
  } finally {
    video.pause();
    if (reusable) video.currentTime = Math.min(restoreTime, Math.max(0, video.duration - 0.001));
    else { video.removeAttribute("src"); video.load(); }
  }
}

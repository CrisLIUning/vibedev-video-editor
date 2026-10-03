import { encodePngFrameSequence } from "./media.js";
import { getModelSourcePreference } from "./modelSources.js";

let worker = null;
const pending = new Map();

function abortError() {
  const error = new Error("NanoVSR restoration canceled");
  error.name = "AbortError";
  return error;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/nanovsr.worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event) => {
    const message = event.data ?? {};
    const request = pending.get(message.requestId);
    if (!request) return;
    if (message.type === "progress") {
      request.onProgress?.(message);
      return;
    }
    pending.delete(message.requestId);
    request.signal?.removeEventListener("abort", request.abort);
    if (message.type === "result") request.resolve(message.result);
    else request.reject(new Error(message.error || "NanoVSR restoration failed"));
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "NanoVSR worker failed");
    pending.forEach((request) => request.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function enhanceNanoVsrBitmaps({ bitmaps, outputCount = bitmaps.length, signal, onProgress, modelArtifacts }) {
  const requestId = `nanovsr-${crypto.randomUUID?.() ?? Date.now()}`;
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    const abort = () => {
      pending.delete(requestId);
      if (worker === activeWorker) {
        activeWorker.terminate();
        worker = null;
      }
      const error = abortError();
      pending.forEach((request) => {
        request.signal?.removeEventListener("abort", request.abort);
        request.reject(error);
      });
      pending.clear();
      reject(abortError());
    };
    if (signal?.aborted) {
      bitmaps.forEach((bitmap) => bitmap.close?.());
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(requestId, { resolve, reject, onProgress, signal, abort });
    activeWorker.postMessage({
      type: "enhance",
      requestId,
      bitmaps,
      outputCount,
      modelSourcePreference: getModelSourcePreference(),
      hostModelUrls: modelArtifacts,
    }, bitmaps);
  });
}

function waitFor(video, eventName, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, ready);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Could not read the video")); };
    const aborted = () => { cleanup(); reject(abortError()); };
    video.addEventListener(eventName, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

async function loadVideo(src, signal) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  video.load();
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

async function sourceBlobForSegment(segment) {
  if (segment.blob instanceof Blob) return segment.blob;
  const response = await fetch(segment.src);
  return response.ok ? response.blob() : null;
}

export async function restoreNanoVsrImage({ segment, signal, onProgress, modelArtifacts }) {
  const response = await fetch(segment.src);
  if (!response.ok) throw new Error(`Could not read image (HTTP ${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  const result = await enhanceNanoVsrBitmaps({
    bitmaps: [bitmap],
    outputCount: 1,
    signal,
    onProgress,
    modelArtifacts,
  });
  return { ...result, blob: result.blobs[0], type: "image" };
}

export async function restoreNanoVsrVideo({
  segment,
  signal,
  onProgress,
  frameRate = 12,
  modelArtifacts,
}) {
  const video = await loadVideo(segment.src, signal);
  const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
  const sourceDuration = Math.max(0.001, Math.min(
    Math.max(0.001, (Number(video.duration) || 0) - sourceStart),
    Number(segment.sourceDuration) || Number(segment.duration) || Number(video.duration) || 0.001,
  ));
  const safeRate = Math.max(1, Math.min(15, Math.round(frameRate)));
  const totalFrames = Math.max(1, Math.ceil(sourceDuration * safeRate));
  const sourceBlob = await sourceBlobForSegment(segment);
  let groupStart = -1;
  let groupResults = [];
  let outputMeta = null;
  try {
    const blob = await encodePngFrameSequence({
      totalFrames,
      frameRate: safeRate,
      signal,
      audioSourceBlob: sourceBlob,
      audioStart: sourceStart,
      audioDuration: sourceDuration,
      onProgress,
      produceFrame: async (index) => {
        const nextGroup = Math.floor(index / 5) * 5;
        if (nextGroup !== groupStart) {
          groupStart = nextGroup;
          const count = Math.min(5, totalFrames - groupStart);
          const bitmaps = [];
          for (let offset = 0; offset < count; offset += 1) {
            await seek(video, sourceStart + (groupStart + offset) / safeRate, signal);
            bitmaps.push(await createImageBitmap(video));
          }
          const result = await enhanceNanoVsrBitmaps({
            bitmaps,
            outputCount: count,
            signal,
            modelArtifacts,
            onProgress: (message) => {
              onProgress?.({
                progress: 3 + ((groupStart + (message.value || 0) * count) / totalFrames) * 87,
                phaseKey: message.phaseKey,
                frameIndex: Math.min(totalFrames, groupStart + 1),
                totalFrames,
                backend: message.backend || "webgpu",
              });
            },
          });
          outputMeta = result;
          groupResults = result.blobs;
        }
        onProgress?.({
          progress: Math.min(90, 3 + ((index + 1) / totalFrames) * 87),
          phaseKey: "hdRestorePhaseFrame",
          frameIndex: index + 1,
          totalFrames,
          backend: "webgpu",
        });
        return groupResults[index - groupStart];
      },
    });
    return {
      blob,
      type: "video",
      width: outputMeta?.width || video.videoWidth * 4,
      height: outputMeta?.height || video.videoHeight * 4,
      sourceDuration,
      frameRate: safeRate,
      totalFrames,
      backend: "webgpu",
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

export function disposeNanoVsrWorker() {
  worker?.terminate();
  worker = null;
  pending.forEach((request) => request.reject(new Error("NanoVSR worker closed")));
  pending.clear();
}

if (import.meta.hot) import.meta.hot.dispose(disposeNanoVsrWorker);

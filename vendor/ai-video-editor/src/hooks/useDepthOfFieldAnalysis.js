import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVisionKey } from "../lib/vision.js";
import { getVisualSourceTime } from "../lib/visualEffects.js";
import { encodeAvatarFrames } from "../lib/editorRuntime.js";
import { startDepthCapability } from "../lib/depthCapability.js";
import { createDepthCapabilityOutput } from "../lib/depthArtifacts.js";

import { applyMediaCrossOrigin } from "../lib/mediaCrossOrigin.js";
const QUALITY = {
  fast: { fps: 4, maxDimension: 392 },
  balanced: { fps: 8, maxDimension: 504 },
  quality: { fps: 12, maxDimension: 518 },
};

function waitForEvent(target, eventName, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, done);
      signal?.removeEventListener("abort", aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const aborted = () => { cleanup(); reject(new DOMException("Canceled", "AbortError")); };
    target.addEventListener(eventName, done, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function createWorkerClient(onSetupProgress) {
  const worker = new Worker(new URL("../workers/depth-anything.worker.js", import.meta.url), { type: "module" });
  let requestId = 0;
  const pending = new Map();
  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "setup-progress") {
      onSetupProgress?.(message);
      return;
    }
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.type === "error") request.reject(new Error(message.message || "Depth inference failed"));
    else request.resolve(message);
  };
  const call = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    requestId += 1;
    pending.set(requestId, { resolve, reject });
    worker.postMessage({ type, requestId, ...payload }, transfer);
  });
  return {
    setup: (modelArtifacts) => call("setup", { modelArtifacts }),
    infer: (bitmap, width, height) => call("infer", { bitmap, width, height }, [bitmap]),
    dispose: () => {
      pending.forEach(({ reject }) => reject(new DOMException("Worker closed", "AbortError")));
      pending.clear();
      worker.terminate();
    },
  };
}

function depthPixelsToBlob(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: false });
  const image = context.createImageData(width, height);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 1, targetIndex += 4) {
    const value = pixels[sourceIndex];
    image.data[targetIndex] = value;
    image.data[targetIndex + 1] = value;
    image.data[targetIndex + 2] = value;
    image.data[targetIndex + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) reject(new Error("Unable to encode depth map"));
    else resolve(blob);
  }, "image/png"));
}

function depthSource(segment) {
  return {
    assetId: String(segment?.assetId || ""),
    versionId: String(segment?.assetVersionId || ""),
    clipId: String(segment?.id || ""),
    localAssetId: String(segment?.localAssetId || segment?.assetId || segment?.id || ""),
    name: String(segment?.name || (segment?.type === "video" ? "local-video.mp4" : "local-image.png")),
    blob: segment?.blob,
    mediaType: segment?.type === "video" ? "video" : "image",
    sourceStart: Math.max(0, Number(segment?.sourceStart) || 0),
    sourceDuration: Math.max(0.05, Number(segment?.sourceDuration) || Number(segment?.duration) || 0.05),
  };
}

async function prepareSource(segment, signal) {
  if (segment.type === "image") {
    const image = new Image();
    applyMediaCrossOrigin(image, segment.src);
    image.src = segment.src;
    if (!image.complete) await waitForEvent(image, "load", signal);
    return { media: image, cleanup: () => {}, width: image.naturalWidth, height: image.naturalHeight };
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const objectUrl = segment.blob instanceof Blob ? URL.createObjectURL(segment.blob) : "";
  applyMediaCrossOrigin(video, objectUrl || segment.src);
  video.src = objectUrl || segment.src;
  video.preload = "auto";
  if (video.readyState < 1) await waitForEvent(video, "loadedmetadata", signal);
  return {
    media: video,
    cleanup: () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    width: video.videoWidth,
    height: video.videoHeight,
  };
}

async function seekVideo(video, time, signal) {
  const target = Math.min(Math.max(0, (video.duration || 0) - 0.025), Math.max(0, time));
  if (Math.abs(video.currentTime - target) < 0.008 && video.readyState >= 2) return;
  video.currentTime = target;
  await waitForEvent(video, "seeked", signal);
}

function userError(error, t) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/webgpu|adapter|device/i.test(message)) return t("depthWebGpuRequired");
  if (/failed to fetch|fetch failed|network/i.test(message)) return t("depthModelUnavailable");
  return message || t("depthAnalysisFailed");
}

export function useDepthOfFieldAnalysis({
  segment,
  depthRecords,
  setDepthRecords,
  updateEffect,
  effectField = "cinematicDepth",
  readyToastKey = "depthReadyToast",
  notify,
  setCurrentTime,
  timelineStart = 0,
  t,
  capabilityRuntime,
  onSourcePinned,
}) {
  const key = getVisionKey(segment);
  const record = key ? depthRecords[key] || null : null;
  const [job, setJob] = useState({ running: false, key: "", stage: "idle", progress: 0, phase: "", error: "" });
  const workerRef = useRef(null);
  const abortRef = useRef(null);
  const urlsRef = useRef(new Map());

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = createWorkerClient(({ progress }) => {
        if (!Number.isFinite(progress)) return;
        setJob((current) => current.running && current.stage === "setup"
          ? { ...current, progress: Math.max(current.progress, Math.round(progress)), phase: t("depthModelDownloading") }
          : current);
      });
    }
    return workerRef.current;
  }, [t]);

  useEffect(() => () => {
    abortRef.current?.abort();
    workerRef.current?.dispose();
    urlsRef.current.forEach((urls) => urls.forEach((url) => URL.revokeObjectURL(url)));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setJob((current) => ({ ...current, running: false, stage: "idle", phase: t("depthCanceled") }));
  }, [t]);

  const analyze = useCallback(async () => {
    if (!segment?.src || !key) return void notify(t("effectSelectClip"));
    if (job.running) {
      cancel();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const effect = segment?.[effectField] || {};
    const quality = QUALITY[effect.quality] || QUALITY.balanced;
    setJob({ running: true, key, stage: "setup", progress: 1, phase: t("depthModelPreparing"), error: "" });
    let source;
    let depthSession = null;
    const createdUrls = [];
    try {
      const requestedSource = depthSource(segment);
      depthSession = await startDepthCapability({
        capabilityRuntime,
        title: t("depthAnalysis"),
        source: requestedSource,
        signal: controller.signal,
      });
      if (depthSession?.source?.versionId && requestedSource.versionId !== depthSession.source.versionId) {
        onSourcePinned?.(requestedSource.localAssetId, depthSession.source);
      }
      const worker = ensureWorker();
      await worker.setup(depthSession?.modelArtifacts);
      if (controller.signal.aborted) throw new DOMException("Canceled", "AbortError");
      setJob({ running: true, key, stage: "analysis", progress: 0, phase: t("depthAnalyzingFrames"), error: "" });
      source = await prepareSource(segment, controller.signal);
      const scale = Math.min(1, quality.maxDimension / Math.max(source.width, source.height));
      const width = Math.max(14, Math.round(source.width * scale / 14) * 14);
      const height = Math.max(14, Math.round(source.height * scale / 14) * 14);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
      const duration = segment.type === "video" ? Math.max(0.05, Number(segment.duration) || 0.05) : 0;
      const count = segment.type === "video" ? Math.max(1, Math.min(360, Math.ceil(duration * quality.fps))) : 1;
      const samples = [];
      const persistentSamples = [];
      for (let index = 0; index < count; index += 1) {
        if (controller.signal.aborted) throw new DOMException("Canceled", "AbortError");
        const localTime = segment.type === "video" ? Math.min(duration, index / quality.fps) : 0;
        const sourceTime = segment.type === "video" ? getVisualSourceTime(segment, localTime) : 0;
        if (segment.type === "video") await seekVideo(source.media, sourceTime, controller.signal);
        context.drawImage(source.media, 0, 0, width, height);
        const bitmap = await createImageBitmap(canvas);
        const result = await worker.infer(bitmap, width, height);
        if (controller.signal.aborted) throw new DOMException("Canceled", "AbortError");
        const depthBlob = await depthPixelsToBlob(new Uint8Array(result.pixels), result.width, result.height);
        const depthUrl = URL.createObjectURL(depthBlob);
        createdUrls.push(depthUrl);
        samples.push({ time: localTime, sourceTime, depthUrl, width: result.width, height: result.height });
        persistentSamples.push({ time: localTime, sourceTime, depthBlob, width: result.width, height: result.height });
        const progress = Math.round(((index + 1) / count) * 100);
        setJob({ running: true, key, stage: "analysis", progress, phase: t("depthFrameProgress").replace("{current}", index + 1).replace("{total}", count), error: "" });
        setDepthRecords((records) => ({
          ...records,
          [key]: {
            complete: false,
            samples: [...samples],
            sourceSize: { width: source.width, height: source.height },
            fps: quality.fps,
            model: "Depth Anything V2 Small · Q4F16 · WebGPU",
          },
        }));
        setCurrentTime?.(timelineStart + Math.min(duration, localTime));
      }
      const analysis = {
        complete: true,
        samples,
        sourceSize: { width: source.width, height: source.height },
        duration,
        fps: quality.fps,
        model: "Depth Anything V2 Small · Q4F16 · WebGPU",
        analyzedAt: Date.now(),
      };
      if (depthSession) {
        const capabilityOutput = await createDepthCapabilityOutput({
          analysis: { ...analysis, samples: persistentSamples },
          source: depthSession.source,
          model: depthSession.model,
          encodeFrames: encodeAvatarFrames,
          signal: controller.signal,
        });
        const completed = await depthSession.complete(capabilityOutput);
        analysis.hostAnalysis = completed?.documentResult || capabilityOutput.analysisResult;
      }
      const oldUrls = urlsRef.current.get(key) || [];
      oldUrls.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.set(key, createdUrls);
      setDepthRecords((records) => ({ ...records, [key]: analysis }));
      updateEffect?.({ ...segment?.[effectField], enabled: true });
      setJob({ running: false, key, stage: "complete", progress: 100, phase: t("depthAnalysisComplete"), error: "" });
      notify(t(readyToastKey));
    } catch (error) {
      if (error?.name === "AbortError") {
        await depthSession?.cancel().catch(() => undefined);
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
        setJob({ running: false, key, stage: "idle", progress: 0, phase: t("depthCanceled"), error: "" });
        return;
      }
      console.error("[Cinematic Depth]", error);
      await depthSession?.fail(error).catch(() => undefined);
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
      const detail = userError(error, t);
      setJob({ running: false, key, stage: "error", progress: 0, phase: t("depthAnalysisFailed"), error: detail });
      notify(`${t("depthAnalysisFailed")}：${detail}`);
    } finally {
      source?.cleanup?.();
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [cancel, capabilityRuntime, effectField, ensureWorker, job.running, key, notify, onSourcePinned, readyToastKey, segment, setCurrentTime, setDepthRecords, t, timelineStart, updateEffect]);

  return useMemo(() => ({ key, record, job, analyze, cancel }), [analyze, cancel, job, key, record]);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeAvatarFrames } from "../lib/editorRuntime.js";
import {
  configureFaceSwapModels,
  disposeFaceSwapRuntime,
  generateFaceSwapMedia,
  prepareFaceSwapSource,
} from "../lib/faceSwap.js";
import { startFaceSwapCapability } from "../lib/faceSwapCapability.js";
import {
  createGeneratedMediaMetadata,
  embedGeneratedMediaMetadata,
} from "../lib/generatedMediaMetadata.js";
import { createVideoTrackFramesFromBlobs } from "../lib/media.js";

import { withHostIdentity } from "../lib/hostAuthorizedMedia.js";
function createWorker() {
  return new Worker(new URL("../workers/face-swap.worker.js", import.meta.url), { type: "module" });
}

function errorMessage(error, t) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/FACE_SWAP_WEBGPU_REQUIRED/.test(message)) return t("faceSwapWebGpuRequired");
  if (/FACE_SWAP_MODEL_UNAVAILABLE/i.test(message)) {
    const [, kind = "", details = ""] = message.match(/FACE_SWAP_MODEL_UNAVAILABLE:([^:]+):(.*)/s) || [];
    return `${t("faceSwapModelUnavailable")}${kind ? ` [MobileFaceSwap ${kind}]` : ""}${details ? ` — ${details}` : ""}`;
  }
  if (/Failed to fetch|fetch failed/i.test(message)) return t("faceSwapModelUnavailable");
  return message;
}

export function useFaceSwapGeneration(d) {
  const [source, setSource] = useState(null);
  const [job, setJob] = useState({
    running: false,
    stage: "idle",
    progress: 0,
    phase: "",
    error: "",
  });
  const [lastResult, setLastResult] = useState(null);
  const workerRef = useRef(null);
  const abortRef = useRef(null);
  const sourceUrlRef = useRef("");

  const setSourceFile = useCallback((file) => {
    if (!(file instanceof Blob) || !String(file.type || "").startsWith("image/")) {
      d.notify(d.t("faceSwapSourceImageOnly"));
      return;
    }
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = URL.createObjectURL(file);
    setSource({
      blob: file,
      name: file.name || "source-face",
      url: sourceUrlRef.current,
      key: `${file.name || "source"}:${file.size}:${file.lastModified || 0}`,
    });
  }, [d]);

  const clearSource = useCallback(() => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = "";
    setSource(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const generate = useCallback(async () => {
    if (job.running) return;
    if (!source?.blob) return void d.notify(d.t("faceSwapNeedsSource"));
    if (!d.previewVisualSrc || !d.previewVisualType) return void d.notify(d.t("faceSwapNeedsTarget"));
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    workerRef.current ??= createWorker();
    let capabilitySession = null;
    let removeCapabilityAbort = () => {};
    setJob({ running: true, stage: "setup", progress: 1, phase: d.t("faceSwapPreparingSource"), error: "" });
    try {
      capabilitySession = await startFaceSwapCapability({
        capabilityRuntime: d.capabilityRuntime,
        outputKind: d.previewVisualType === "image" ? "image" : "video",
        title: d.t("faceSwapTitle"),
      });
      if (capabilitySession) {
        const abortLocal = () => controller.abort(capabilitySession.signal.reason);
        capabilitySession.signal.addEventListener("abort", abortLocal, { once: true });
        removeCapabilityAbort = () => capabilitySession?.signal.removeEventListener("abort", abortLocal);
        await configureFaceSwapModels({
          worker: workerRef.current,
          modelUrls: capabilitySession.modelArtifacts,
          requestId,
          signal: controller.signal,
        });
      }
      const targetBlob = d.previewVisualSegment?.blob instanceof Blob
        ? d.previewVisualSegment.blob
        : await fetch(d.previewVisualSrc, { signal: controller.signal }).then((response) => {
            if (!response.ok) throw new Error(`读取目标素材失败（HTTP ${response.status}）`);
            return response.blob();
          });
      await prepareFaceSwapSource({
        worker: workerRef.current,
        blob: source.blob,
        sourceKey: source.key,
        requestId,
        signal: controller.signal,
        onProgress: (progress) => {
          const value = Math.round(progress.progress || 0);
          const phase = d.t(progress.phaseKey || "faceSwapModelSetup");
          setJob({ running: true, stage: "setup", progress: value, phase, error: "" });
          void capabilitySession?.progress({ progress: Math.min(55, 35 + Math.round(value * 0.2)), phase });
        },
      });
      setJob({ running: true, stage: "generation", progress: 0, phase: d.t("faceSwapGeneration"), error: "" });
      const generationStartedAt = performance.now();
      const result = await generateFaceSwapMedia({
        worker: workerRef.current,
        targetBlob,
        targetType: d.previewVisualType,
        duration: d.previewVisualSegment?.duration || d.imageDuration || 4,
        sourceStart: d.previewVisualSegment?.sourceStart || 0,
        requestId,
        signal: controller.signal,
        fps: Number(import.meta.env.VITE_FACE_SWAP_FPS || 8),
        anchorFps: Number(import.meta.env.VITE_FACE_SWAP_TRACKING_ANCHOR_FPS || 2),
        onProgress: (progress) => {
          const template = d.t(progress.phaseKey || "faceSwapGeneration");
          const phase = Object.entries(progress.phaseParams || {}).reduce(
            (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
            template,
          );
          setJob({
            running: true,
            stage: "generation",
            progress: Math.round(progress.progress || 0),
            phase,
            error: "",
          });
          void capabilitySession?.progress({
            progress: Math.min(95, 55 + Math.round((Number(progress.progress) || 0) * 0.4)),
            phase,
          });
        },
      });
      const frameProcessingMs = performance.now() - generationStartedAt;
      let blob = result.blob;
      let encodingMs = 0;
      if (result.type === "video-frames") {
        setJob({ running: true, stage: "generation", progress: 96, phase: d.t("faceSwapEncoding"), error: "" });
        const encodingStartedAt = performance.now();
        blob = await encodeAvatarFrames(
          result.blobs,
          result.width,
          result.height,
          result.fps,
          result.keyframeTimes,
          result.duration,
          {
            signal: controller.signal,
            onProgress: (value) => setJob({
              running: true,
              stage: "generation",
              progress: 96 + Math.round(value * 4),
              phase: d.t("faceSwapEncoding"),
              error: "",
            }),
          },
        );
        encodingMs = performance.now() - encodingStartedAt;
      }
      const contentId = crypto.randomUUID();
      const generationMetadata = createGeneratedMediaMetadata({ contentId });
      const [embeddedBlob, trackFrames] = await Promise.all([
        embedGeneratedMediaMetadata(blob, generationMetadata),
        result.type === "video-frames"
          ? createVideoTrackFramesFromBlobs(result.blobs, {
              duration: result.duration,
              width: result.width,
              height: result.height,
              signal: controller.signal,
            })
          : [],
      ]);
      blob = embeddedBlob;
      const extension = result.type === "image" ? "png" : "webm";
      const filename = `mobilefaceswap-${new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "")}.${extension}`;
      const completion = await capabilitySession?.complete(blob, filename, {
        track: "visuals",
        duration: result.duration || d.imageDuration || 4,
      });
      const persistedAsset = completion?.asset;
      const url = persistedAsset?.url || URL.createObjectURL(blob);
      if (!persistedAsset) d.imageUrlRefs.current.add(url);
      const asset = {
        id: persistedAsset?.assetId || contentId,
        type: result.type === "image" ? "image" : "video",
        src: url,
        name: filename,
        meta: `${result.width} x ${result.height} · MobileFaceSwap 224 · Local WebGPU${result.inferenceFrames ? ` · ${result.inferenceFrames} generated frames` : ""}`,
        blob,
        duration: result.duration,
        width: result.width,
        height: result.height,
        trackFrames,
        trackFrameDuration: result.type === "video-frames" ? result.duration : 0,
        generatedBy: "mobilefaceswap-224",
        // `sourceAssetId` meant "derived from" elsewhere (depth, segmentation),
        // so recording the asset's OWN id under it left this card with no
        // readable assetId at all.
        ...(persistedAsset ? withHostIdentity({}, persistedAsset) : {}),
        generationMetadata,
        diagnostics: {
          frameProcessingMs,
          encodingMs,
          inferenceFrames: result.inferenceFrames || 1,
          inferenceMs: result.inferenceMs || 0,
          model: result.model || "mobilefaceswap-224",
          totalFrames: result.totalFrames || 1,
          timelineFrames: trackFrames.length,
        },
      };
      console.info("[Face Swap][Performance]", JSON.stringify(asset.diagnostics));
      setLastResult(asset);
      d.setUserAssets((items) => [asset, ...items]);
      d.setSelectedLibraryAssetId(asset.id);
      d.setActiveTool("media");
      d.setMediaTab("mine");
      setJob({ running: false, stage: "complete", progress: 100, phase: d.t("faceSwapComplete"), error: "" });
      d.notify(d.t("faceSwapAddedToAssets"));
    } catch (error) {
      if (error?.name === "AbortError") {
        await capabilitySession?.cancel().catch(() => undefined);
        setJob({ running: false, stage: "idle", progress: 0, phase: d.t("faceSwapCanceled"), error: "" });
        d.notify(d.t("faceSwapCanceled"));
      } else {
        await capabilitySession?.fail(error).catch(() => undefined);
        const detail = errorMessage(error, d.t);
        setJob({ running: false, stage: "error", progress: 0, phase: "", error: detail });
        d.notify(`${d.t("faceSwapFailed")}：${detail}`);
      }
    } finally {
      removeCapabilityAbort();
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [d, job.running, source]);

  useEffect(() => () => {
    abortRef.current?.abort();
    workerRef.current?.terminate();
    disposeFaceSwapRuntime();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  const downloadResult = useCallback(() => {
    if (!lastResult?.blob) return;
    d.downloadBlob(lastResult.blob, lastResult.name);
  }, [d, lastResult]);

  return {
    source,
    job,
    lastResult,
    setSourceFile,
    clearSource,
    generate,
    cancel,
    downloadResult,
  };
}

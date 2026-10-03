import { useCallback } from "react";
import { MIN_VISUAL_SEGMENT_SECONDS } from "../config/editor.js";
import { getJoyVasaProjectModelBaseUrls } from "../config/joyVasa.js";
import { getLivePortraitProjectModelBaseUrls } from "../config/livePortrait.js";
import { startAvatarCapability } from "../lib/avatarCapability.js";
import { decodeAvatarAudio16k, encodeAvatarFrames, formatAvatarProgress, runAvatarWorkerTask } from "../lib/editorRuntime.js";

import { withHostIdentity } from "../lib/hostAuthorizedMedia.js";
const createMotionWorker = () => new Worker(new URL("../workers/joyvasa.worker.js", import.meta.url), { type: "module" });
const createRenderWorker = () => new Worker(new URL("../workers/liveportrait.worker.js", import.meta.url), { type: "module" });

export function useAvatarGeneration(d) {
  const openAvatarPanel = useCallback(() => {
    d.setAvatarPanelOpen(true);
    if (!d.avatarMotionWorkerRef.current) d.avatarMotionWorkerRef.current = createMotionWorker();
    if (!d.avatarRenderWorkerRef.current) d.avatarRenderWorkerRef.current = createRenderWorker();
  }, [d]);
  const generateAvatarAcceptanceFrame = useCallback(async (quality = "preview") => {
    if (d.avatarJob.running) return;
    if (!d.previewVisualSrc || d.previewVisualType !== "image") return void d.notify(d.t("avatarNeedsPortrait"));
    if (!d.audioBlob) return void d.notify(d.t("avatarNeedsAudio"));
    const controller = new AbortController();
    let capabilitySession = null;
    let removeCapabilityAbort = () => {};
    d.setAvatarJob({ running: true, progress: 1, phase: d.t("avatarPreparing") });
    try {
      capabilitySession = await startAvatarCapability({
        capabilityRuntime: d.capabilityRuntime,
        title: d.t("avatarTitle"),
        quality,
        signal: controller.signal,
      });
      const executionSignal = capabilitySession?.signal || controller.signal;
      if (capabilitySession) {
        const stopWorkers = () => {
          d.avatarMotionWorkerRef.current?.terminate();
          d.avatarRenderWorkerRef.current?.terminate();
          d.avatarMotionWorkerRef.current = null;
          d.avatarRenderWorkerRef.current = null;
        };
        capabilitySession.signal.addEventListener("abort", stopWorkers, { once: true });
        removeCapabilityAbort = () => capabilitySession?.signal.removeEventListener("abort", stopWorkers);
      }
      const joyVasaModelBaseUrls = getJoyVasaProjectModelBaseUrls(d.uiLanguage);
      const livePortraitModelBaseUrls = getLivePortraitProjectModelBaseUrls(d.uiLanguage);
      const portrait = d.previewVisualSegment?.blob instanceof Blob ? d.previewVisualSegment.blob : await fetch(d.previewVisualSrc, { signal: executionSignal }).then((response) => {
        if (!response.ok) throw new Error(`读取肖像失败（HTTP ${response.status}）`); return response.blob();
      });
      const testDuration = import.meta.env.DEV ? Number(import.meta.env.VITE_AVATAR_TEST_DURATION || 0) : 0;
      const duration = testDuration > 0 ? Math.max(0.5, Math.min(4, testDuration))
        : Math.max(MIN_VISUAL_SEGMENT_SECONDS, Math.min(4, d.audioDuration || d.imageDuration || 4));
      let motionBuffer;
      if (d.avatarMotionCacheRef.current.audioBlob === d.audioBlob && d.avatarMotionCacheRef.current.motion) {
        motionBuffer = d.avatarMotionCacheRef.current.motion.slice(0);
        d.setAvatarJob({ running: true, progress: 65, phase: d.t("avatarProgressReuseMotion") });
      } else {
        if (d.avatarRenderWorkerRef.current) await runAvatarWorkerTask(d.avatarRenderWorkerRef.current, { type: "releaseGpuSessions" }, [], "gpuReleased", undefined, { signal: executionSignal });
        const samples = await decodeAvatarAudio16k(d.audioBlob);
        if (executionSignal.aborted) throw executionSignal.reason || new DOMException("Canceled", "AbortError");
        if (!d.avatarMotionWorkerRef.current) d.avatarMotionWorkerRef.current = createMotionWorker();
        const result = await runAvatarWorkerTask(d.avatarMotionWorkerRef.current,
          { type: "generate", audioSamples: samples.buffer, modelBaseUrl: joyVasaModelBaseUrls, modelArtifacts: capabilitySession?.modelArtifacts }, [samples.buffer], "motion",
          (progress) => {
            const phase = formatAvatarProgress(d.t, progress);
            d.setAvatarJob({ running: true, progress: progress.progress, phase });
            void capabilitySession?.progress({ progress: Math.min(50, Math.round(Number(progress.progress) * 0.5)), phase }).catch(() => undefined);
          }, { signal: executionSignal });
        d.avatarMotionCacheRef.current = { audioBlob: d.audioBlob, motion: result.motion.slice(0) }; motionBuffer = result.motion;
        await runAvatarWorkerTask(d.avatarMotionWorkerRef.current, { type: "release", modelBaseUrl: joyVasaModelBaseUrls, modelArtifacts: capabilitySession?.modelArtifacts }, [], "released", undefined, { signal: executionSignal });
      }
      if (!d.avatarRenderWorkerRef.current) d.avatarRenderWorkerRef.current = createRenderWorker();
      const result = await runAvatarWorkerTask(d.avatarRenderWorkerRef.current, {
        type: "generateVideo", portraitBlob: portrait, motionBuffer,
        modelBaseUrl: import.meta.env.VITE_LIVE_PORTRAIT_MODEL_BASE_URL || "",
        joyVasaModelBaseUrl: joyVasaModelBaseUrls, joyVasaModelArtifacts: capabilitySession?.modelArtifacts,
        webGpuModelBaseUrl: livePortraitModelBaseUrls,
        livePortraitModelArtifacts: capabilitySession?.modelArtifacts,
        quality, renderFps: Math.max(1, Number(import.meta.env.VITE_AVATAR_RENDER_FPS || 8)),
        neuralFps: Math.max(1, Number(import.meta.env.VITE_AVATAR_NEURAL_FPS || 2)), duration,
        portraitKey: d.previewVisualSegment?.id || d.previewVisualSrc,
      }, [motionBuffer], "videoFrames",
      (progress) => {
        const phase = formatAvatarProgress(d.t, progress);
        d.setAvatarJob({ running: true, progress: progress.progress, phase });
        void capabilitySession?.progress({ progress: Math.min(90, 50 + Math.round(Number(progress.progress) * 0.4)), phase }).catch(() => undefined);
      }, { signal: executionSignal });
      d.setAvatarJob({ running: true, progress: 99, phase: d.t("avatarProgressEncodeVideo") });
      const blob = await encodeAvatarFrames(result.blobs, result.width, result.height, result.fps, result.keyframeTimes, result.duration, {
        signal: executionSignal,
        onProgress: (value) => void capabilitySession?.progress({
          progress: 90 + Math.round(value * 8),
          phase: d.t("avatarProgressEncodeVideo"),
        }).catch(() => undefined),
      });
      const fileName = "liveportrait-joyvasa.webm";
      const completion = await capabilitySession?.complete(blob, fileName, {
        track: "visuals",
        duration,
        replaceClipId: d.previewVisualSegment.id,
        width: result.width,
        height: result.height,
      });
      const persistedAsset = completion?.asset;
      if (capabilitySession && !persistedAsset) throw new DOMException("Avatar task is no longer active", "AbortError");
      const src = persistedAsset?.url || URL.createObjectURL(blob);
      if (!persistedAsset) d.imageUrlRefs.current.add(src);
      const asset = {
        id: persistedAsset?.versionId || crypto.randomUUID(),
        ...(persistedAsset ? withHostIdentity({}, persistedAsset) : {}),
        type: "video", src, name: fileName,
        meta: `${result.width} x ${result.height} · JoyVASA + LivePortrait FP16 WebGPU`, blob, duration, width: result.width, height: result.height, trackFrames: [],
      };
      d.setUserAssets((assets) => [asset, ...assets]);
      if (!capabilitySession) d.replaceVisualTimeline(asset, duration);
      d.setCurrentTime(0);
      d.setAvatarJob({ running: false, progress: 100, phase: d.t("avatarAcceptanceDone") }); d.notify(d.t("avatarTrackReplaced"));
    } catch (error) {
      if (error?.name === "AbortError") {
        await capabilitySession?.cancel().catch(() => undefined);
        d.setAvatarJob({ running: false, progress: 0, phase: "" });
      } else {
        await capabilitySession?.fail(error).catch(() => undefined);
        d.setAvatarJob({ running: false, progress: 0, phase: "" });
        d.notify(`${d.t("avatarGenerationFailed")}：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      removeCapabilityAbort();
    }
  }, [d]);
  return { generateAvatarAcceptanceFrame, openAvatarPanel };
}

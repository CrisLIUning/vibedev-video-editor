import { useCallback, useEffect, useRef, useState } from "react";

import { buildEnglishMusicPrompt, createAiMusicFileName, translateMusicDescriptionToEnglish } from "../lib/aiMusicPrompt.js";
import { advanceAiMusicProgress, mapAiMusicWorkerProgress } from "../lib/aiMusicBackend.js";
import { repeatPcm16WavAtBestBoundary } from "../lib/aiMusicLoop.js";
import { decodeWaveform } from "../lib/media.js";
import { getModelSourcePreference } from "../lib/modelSources.js";
import { waitForModelCacheServiceWorker } from "../lib/serviceWorker.js";

import { withHostIdentity } from "../lib/hostAuthorizedMedia.js";
export function useAiMusicGeneration({ activeLanguage, imageUrlRefs, setActiveTool, setMediaTab, setSelectedLibraryAssetId, setUserAssets, capabilityRuntime }) {
  const workerRef = useRef(null);
  const capabilityTaskRef = useRef(null);
  const [job, setJob] = useState({ state: "idle", progress: 0, phase: "", error: "" });

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    const taskId = capabilityTaskRef.current?.taskId;
    capabilityTaskRef.current = null;
    if (taskId) void capabilityRuntime?.cancel(taskId).catch(() => undefined);
    setJob({ state: "idle", progress: 0, phase: "", error: "" });
  }, [capabilityRuntime]);

  useEffect(() => cancel, [cancel]);

  const generate = useCallback(async (selection) => {
    setJob({ state: "running", progress: 0.01, phase: "checking", error: "" });
    const capabilityRequest = capabilityRuntime ? {
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      capability: "music",
      title: createAiMusicFileName(selection),
      outputKind: "audio",
      parameters: {
        seconds: Number(selection.seconds) || 30,
        description: String(selection.description || ""),
      },
    } : null;
    let capabilityTask = null;
    if (capabilityRequest) {
      try {
        capabilityTask = await capabilityRuntime.start(capabilityRequest);
        capabilityTaskRef.current = capabilityTask;
        capabilityTask.signal.addEventListener("abort", () => {
          workerRef.current?.terminate();
          workerRef.current = null;
          capabilityTaskRef.current = null;
          setJob({ state: "idle", progress: 0, phase: "", error: "" });
        }, { once: true });
        void capabilityRuntime.progress(capabilityTask.taskId, { progress: 1, phase: "preparing-model" }).catch(() => undefined);
      } catch (error) {
        setJob({ state: "error", progress: 0, phase: "", error: error?.message || String(error) });
        return;
      }
    }
    const translationPromise = translateMusicDescriptionToEnglish(
      selection.description || "",
      activeLanguage,
      { signal: capabilityTask?.signal, timeoutMs: 1_500, fallback: "" },
    );
    void translationPromise.catch(() => undefined);
    let modelArtifacts = null;
    if (capabilityTask && capabilityRuntime?.prepareModel) {
      try {
        const prepared = await capabilityRuntime.prepareModel({
          modelId: "stable-audio-3-small-music-onnx",
          signal: capabilityTask.signal,
          onProgress(update) {
            const normalized = Math.max(0, Math.min(1, (Number(update.progress) || 0) / 100));
            const phase = String(update.phase || "preparing-model");
            const uiPhase = phase.startsWith("cached:") || phase === "ready" || normalized >= 1 ? "cache" : "download";
            setJob({
              state: "running",
              progress: Math.min(0.58, 0.02 + normalized * 0.56),
              phase: uiPhase,
              error: "",
            });
            void capabilityRuntime.progress(capabilityTask.taskId, {
              progress: Math.min(58, 2 + Math.round((Number(update.progress) || 0) * 0.56)),
              phase,
            }).catch(() => undefined);
          },
        });
        modelArtifacts = prepared.artifacts;
      } catch (error) {
        if (error?.name === "AbortError") {
          await capabilityRuntime.cancel(capabilityTask.taskId).catch(() => undefined);
        } else {
          await capabilityRuntime.fail(capabilityTask.taskId, {
            code: "VIDEO_EDITOR_MUSIC_MODEL_FAILED",
            message: error?.message || String(error),
          }).catch(() => undefined);
        }
        capabilityTaskRef.current = null;
        setJob({ state: "error", progress: 0, phase: "", error: error?.message || String(error) });
        return;
      }
    }
    let prompt;
    try {
      const descriptionEnglish = await translationPromise;
      prompt = buildEnglishMusicPrompt({ ...selection, descriptionEnglish });
    } catch (error) {
      if (error?.name === "AbortError") {
        if (capabilityTask) await capabilityRuntime.cancel(capabilityTask.taskId).catch(() => undefined);
        capabilityTaskRef.current = null;
        setJob({ state: "idle", progress: 0, phase: "", error: "" });
        return;
      }
      if (capabilityTask) {
        void capabilityRuntime.fail(capabilityTask.taskId, {
          code: "VIDEO_EDITOR_MUSIC_PROMPT_FAILED",
          message: error?.message || String(error),
        }).catch(() => undefined);
        capabilityTaskRef.current = null;
      }
      setJob({ state: "error", progress: 0, phase: "", error: error?.message || String(error) });
      return;
    }
    await navigator.storage?.persist?.().catch(() => false);
    // The model cache is owned by the service worker. On a first-page visit,
    // wait until it controls the page so the initial parallel download is
    // persisted instead of falling through as an uncached worker fetch.
    if (!modelArtifacts) await waitForModelCacheServiceWorker();
    const worker = workerRef.current ?? new Worker(new URL("../workers/ai-music.worker.js", import.meta.url), { type: "module" });
    const warmRuntime = Boolean(workerRef.current);
    const hostedRuntime = Boolean(modelArtifacts);
    workerRef.current = worker;
    setJob({
      state: "running",
      progress: warmRuntime ? 0.64 : hostedRuntime ? 0.58 : 0.01,
      phase: warmRuntime ? "conditioning" : hostedRuntime ? "cache" : "checking",
      error: "",
    });
    worker.onmessage = async ({ data }) => {
      if (data.type === "progress") {
        const visibleProgress = mapAiMusicWorkerProgress(data.progress, hostedRuntime);
        setJob((current) => ({
          ...current,
          progress: advanceAiMusicProgress(current.progress, data.progress, hostedRuntime),
          phase: data.phase,
          backend: data.backend || current.backend,
        }));
        if (capabilityTask) {
          void capabilityRuntime.progress(capabilityTask.taskId, {
            progress: Math.max(0, Math.min(100, visibleProgress * 100)),
            phase: String(data.phase || "generating"),
          }).catch(() => undefined);
        }
        return;
      }
      if (data.type === "error") {
        worker.terminate();
        workerRef.current = null;
        if (capabilityTask) {
          void capabilityRuntime.fail(capabilityTask.taskId, {
            code: "VIDEO_EDITOR_MUSIC_RUNTIME_FAILED",
            message: String(data.message || "Music generation failed."),
          }).catch(() => undefined);
          capabilityTaskRef.current = null;
        }
        const cacheWriteFailed = String(data.message || "").startsWith("AI_MUSIC_CACHE_WRITE_FAILED");
        setJob({
          state: "error",
          progress: 0,
          phase: "",
          error: cacheWriteFailed
            ? (String(activeLanguage).toLowerCase().startsWith("zh")
              ? `模型下载或本地缓存失败（${String(data.message).split(": ").at(-1)}），请重试。`
              : `Model download or local caching failed (${String(data.message).split(": ").at(-1)}). Try again.`)
            : data.message,
        });
        return;
      }
      if (data.type !== "complete") return;
      const requestedSeconds = Number(selection.seconds) || 30;
      const wav = requestedSeconds > 60
        ? repeatPcm16WavAtBestBoundary(data.wav, 2, 5)
        : data.wav;
      const blob = new Blob([wav], { type: "audio/wav" });
      let persistedAsset = null;
      if (capabilityTask && capabilityRequest) {
        try {
          const completion = await capabilityRuntime.complete(
            capabilityTask.taskId,
            capabilityRequest,
            {
              blob,
              fileName: capabilityRequest.title,
              mimeType: "audio/wav",
              placement: { track: "music", duration: requestedSeconds, replace: true },
            },
          );
          persistedAsset = completion.asset || null;
          capabilityTaskRef.current = null;
        } catch (error) {
          worker.terminate();
          workerRef.current = null;
          setJob({ state: "error", progress: 0, phase: "", error: error?.message || String(error) });
          return;
        }
      }
      const src = URL.createObjectURL(blob);
      imageUrlRefs.current.add(src);
      const decoded = await decodeWaveform(blob, 96);
      const asset = {
        id: crypto.randomUUID(),
        type: "audio",
        kind: "music",
        name: createAiMusicFileName(selection),
        meta: `AI music · ${decoded.duration.toFixed(1)}s`,
        src,
        previewSrc: src,
        blob,
        duration: decoded.duration,
        peaks: decoded.peaks,
        provider: "Stable Audio 3 Small · ONNX",
        generated: true,
        prompt,
        // Stamp the host identity under every spelling. Recording it ONLY as
        // hostAssetId/hostVersionId is what duplicated this clip: merging keys
        // on assetVersionId, so the host's copy of the same bytes came back as
        // a second card on the next asset refresh.
        ...(persistedAsset ? withHostIdentity({}, persistedAsset) : {}),
      };
      setUserAssets((current) => [asset, ...current]);
      setSelectedLibraryAssetId(asset.id);
      setActiveTool("media");
      setMediaTab("mine");
      setJob({ state: "complete", progress: 1, phase: "complete", error: "" });
    };
    worker.onerror = (event) => {
      worker.terminate();
      workerRef.current = null;
      if (capabilityTask) {
        void capabilityRuntime.fail(capabilityTask.taskId, {
          code: "VIDEO_EDITOR_MUSIC_WORKER_CRASHED",
          message: event.message || "Music generation failed.",
        }).catch(() => undefined);
        capabilityTaskRef.current = null;
      }
      setJob({ state: "error", progress: 0, phase: "", error: event.message || "Music generation failed." });
    };
    worker.postMessage({
      type: "generate",
      prompt,
      seconds: (Number(selection.seconds) || 30) / (Number(selection.seconds) > 60 ? 2 : 1),
      steps: 8,
      seed: Math.floor(Math.random() * 0x7fffffff),
      modelSourcePreference: getModelSourcePreference(activeLanguage),
      modelArtifacts,
    });
  }, [activeLanguage, capabilityRuntime, imageUrlRefs, setActiveTool, setMediaTab, setSelectedLibraryAssetId, setUserAssets]);

  return { job, generate, cancel };
}

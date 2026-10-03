function abortError(signal) {
  if (signal?.reason instanceof DOMException && signal.reason.name === "AbortError") {
    return signal.reason;
  }
  return new DOMException("Automatic caption generation was canceled.", "AbortError");
}

/**
 * Owns the warm Whisper worker while making cancellation physically stop WASM/WebGPU inference.
 * The editor only permits one caption job at a time, so terminating the shared worker is both
 * deterministic and cheaper than keeping an unobservable inference alive after task cancellation.
 */
export function createInterruptibleAsrWorkerClient({ createWorker, createRequestId }) {
  let worker = null;
  let activeRequest = null;

  const stopWorker = (error) => {
    worker?.terminate();
    worker = null;
    if (activeRequest) {
      const request = activeRequest;
      activeRequest = null;
      request.cleanup();
      request.reject(error);
    }
  };

  const ensureWorker = () => {
    if (worker) return worker;
    worker = createWorker();
    if (!worker) return null;
    worker.addEventListener("message", (event) => {
      const message = event.data;
      if (!activeRequest || message?.requestId !== activeRequest.requestId) return;
      if (message.type === "progress") {
        activeRequest.onProgress?.({ progress: message.progress, phase: message.phase });
        return;
      }
      const request = activeRequest;
      activeRequest = null;
      request.cleanup();
      if (message.type === "result") {
        request.resolve({
          output: message.output,
          vad:message.vad, recognitions:message.recognitions,
          language: message.language,
          languageDetected: Boolean(message.languageDetected),
          modelId: message.modelId,
        });
      } else {
        request.reject(new Error(message.error || "自动字幕生成失败"));
      }
    });
    worker.addEventListener("error", (event) => {
      stopWorker(new Error(event.message || "自动字幕 Worker 运行失败"));
    });
    return worker;
  };

  return {
    transcribe(audio, { onProgress, preferredLanguage, signal, modelId, modelArtifacts } = {}) {
      if (signal?.aborted) return Promise.reject(abortError(signal));
      if (activeRequest) return Promise.reject(new Error("已有自动字幕任务正在运行。"));
      const currentWorker = ensureWorker();
      if (!currentWorker) return Promise.reject(new Error("当前浏览器不支持 Worker 自动字幕。"));
      const requestId = createRequestId();
      const transferableAudio = audio.slice();
      return new Promise((resolve, reject) => {
        const onAbort = () => stopWorker(abortError(signal));
        signal?.addEventListener("abort", onAbort, { once: true });
        activeRequest = {
          requestId,
          resolve,
          reject,
          onProgress,
          cleanup: () => signal?.removeEventListener("abort", onAbort),
        };
        currentWorker.postMessage({
          type: "transcribe",
          requestId,
          modelId,
          modelArtifacts,
          audioBuffer: transferableAudio.buffer,
          preferredLanguage,
        }, [transferableAudio.buffer]);
      });
    },
    reset(error = new Error("自动字幕 Worker 已重置。")) {
      stopWorker(error);
    },
    dispose() {
      stopWorker(new DOMException("Automatic caption worker disposed.", "AbortError"));
    },
  };
}

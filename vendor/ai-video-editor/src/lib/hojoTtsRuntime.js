import { voiceModelBaseUrls } from "../config/voiceModels.js";
import { orderModelUrlsForNetwork } from "./modelSources.js";
import { prepareVoiceModelStorage } from "./voiceModelStorage.js";

const MODEL_PATH = "hojo-tts-light-80m-zh-2voices-fp16-v1";
const VOICE_IDS = Object.freeze({
  zh_f_qinglan: "zh_f_qinglan",
  zh_f_ruoxi: "zh_f_ruoxi",
  // Preserve older projects after the two retired Chinese male cards disappear.
  zh_m_yunzhou: "zh_f_qinglan",
  zh_m_jingche: "zh_f_ruoxi",
  zh_m_yansheng: "zh_f_ruoxi",
});

let worker;
let readyPromise;
let activeModelKey = "";
let requestCounter = 0;
const pending = new Map();
const progressListeners = new Set();

function broadcastProgress(event) {
  for (const listener of progressListeners) listener(event);
}

function resetWorker(error) {
  worker?.terminate();
  worker = undefined;
  readyPromise = undefined;
  activeModelKey = "";
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function modelKey(modelArtifacts) {
  if (!modelArtifacts || typeof modelArtifacts !== "object" || !Object.keys(modelArtifacts).length) return "remote";
  return Object.entries(modelArtifacts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactId, artifactUrl]) => `${artifactId}:${artifactUrl}`)
    .join("|");
}

async function ensureWorker(onProgress, modelArtifacts) {
  if (onProgress) progressListeners.add(onProgress);
  const nextModelKey = modelKey(modelArtifacts);
  if (readyPromise && activeModelKey !== nextModelKey) {
    resetWorker(new Error("Hojo model source changed."));
  }
  if (!readyPromise) {
    activeModelKey = nextModelKey;
    readyPromise = (async () => {
      const hosted = modelArtifacts && typeof modelArtifacts === "object" && Object.keys(modelArtifacts).length;
      if (!hosted) {
        await prepareVoiceModelStorage({
          preserveModelPath: MODEL_PATH,
          requiredBytes: 390 * 1024 * 1024,
          clearPiper: true,
          keepKokoroStyles: false,
        });
      }
      const baseUrls = hosted ? [] : await orderModelUrlsForNetwork(voiceModelBaseUrls(MODEL_PATH));
      return new Promise((resolve, reject) => {
        worker = new Worker(new URL("../workers/hojoTts.worker.js", import.meta.url), { type: "module" });
        worker.onmessage = (event) => {
          const message = event.data || {};
          if (message.type === "progress") {
            broadcastProgress({ phase: "initializing", backend: "webgpu+wasm", progress: Math.max(0, Math.min(99, message.value || 0)) });
          } else if (message.type === "mirror-fallback") {
            broadcastProgress({ phase: "initializing", backend: "webgpu+wasm", mirrorFallback: true });
          } else if (message.type === "ready") {
            broadcastProgress({ phase: "ready", backend: message.backend, progress: 100, source: message.source });
            resolve(message);
          } else if (message.type === "audio") {
            const request = pending.get(message.requestId);
            if (!request) return;
            pending.delete(message.requestId);
            request.resolve(new Blob([message.wav], { type: "audio/wav" }));
          } else if (message.type === "cancelled") {
            for (const request of pending.values()) request.reject(new DOMException("Cancelled", "AbortError"));
            pending.clear();
          } else if (message.type === "error") {
            const error = new Error(message.message || "HOJO_TTS_FAILED");
            if (message.requestId && pending.has(message.requestId)) {
              pending.get(message.requestId).reject(error);
              pending.delete(message.requestId);
            } else {
              reject(error);
              resetWorker(error);
            }
          }
        };
        worker.onerror = (event) => {
          const error = new Error(event.message || "HOJO_TTS_WORKER_FAILED");
          reject(error);
          resetWorker(error);
        };
        worker.postMessage({ type: "init", baseUrls, modelArtifacts });
      });
    })().catch((error) => {
      readyPromise = undefined;
      activeModelKey = "";
      throw error;
    });
  }
  try {
    return await readyPromise;
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
}

export async function predictHojoVoice(input, onProgress) {
  await ensureWorker(onProgress, input.modelArtifacts);
  const voice = VOICE_IDS[input.voiceId];
  if (!voice) throw new Error(`UNKNOWN_HOJO_VOICE:${input.voiceId}`);
  const requestId = `hojo-${Date.now()}-${requestCounter += 1}`;
  onProgress?.({ phase: "generating", backend: "webgpu+wasm", progress: 1 });
  if (onProgress) progressListeners.add(onProgress);
  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      resolve: (value) => { if (onProgress) progressListeners.delete(onProgress); resolve(value); },
      reject: (error) => { if (onProgress) progressListeners.delete(onProgress); reject(error); },
    });
    worker.postMessage({ type: "generate", requestId, text: input.text, voice, seed: input.seed ?? 42 });
  });
}

export function cancelHojoVoiceGeneration() {
  worker?.postMessage({ type: "cancel" });
}

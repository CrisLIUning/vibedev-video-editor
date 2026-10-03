import { loadVoiceModelFromMirrors, voiceModelFileUrls } from "../config/voiceModels.js";
import { orderModelUrlsForNetwork, resolveHostModelFile } from "./modelSources.js";
import { prepareVoiceModelStorage } from "./voiceModelStorage.js";

const SHARED_MODEL_CACHE = "timeline-studio-model-cache-v5";
const KOKORO_VOICE_CACHE = "kokoro-voices";
const UPSTREAM_VOICE_PREFIX = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/";

let runtimePromise;
let activeModelKey = "";

const HOST_FILE_KEYS = Object.freeze({
  "config.json": "config",
  "tokenizer.json": "tokenizer",
  "tokenizer_config.json": "tokenizer-config",
  "onnx/model_quantized.onnx": "model-q8",
});

const HOST_VOICE_KEYS = Object.freeze({
  af_heart: "voice-af-heart",
  am_fenrir: "voice-am-fenrir",
});

function modelKey(modelArtifacts) {
  if (!modelArtifacts || typeof modelArtifacts !== "object" || !Object.keys(modelArtifacts).length) return "remote";
  return Object.entries(modelArtifacts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactId, artifactUrl]) => `${artifactId}:${artifactUrl}`)
    .join("|");
}

export function configureKokoroHostModelFiles(env, modelArtifacts) {
  if (!modelArtifacts || typeof modelArtifacts !== "object" || !Object.keys(modelArtifacts).length) {
    env.useCustomCache = false;
    env.customCache = null;
    env.useBrowserCache = false;
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    return false;
  }
  const required = [...new Set([...Object.values(HOST_FILE_KEYS), ...Object.values(HOST_VOICE_KEYS)])];
  const missing = required.filter((artifactId) => !modelArtifacts[artifactId]);
  if (missing.length) throw new Error(`Host Kokoro model is missing artifacts: ${missing.join(", ")}`);
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.customCache = {
    async match(request) {
      const file = resolveHostModelFile(request, HOST_FILE_KEYS);
      if (!file) return undefined;
      const response = await fetch(modelArtifacts[HOST_FILE_KEYS[file]]);
      if (!response.ok) throw new Error(`Host Kokoro model returned HTTP ${response.status}: ${file}`);
      return response;
    },
    async put() {},
  };
  return true;
}

function isLegacyFp32KokoroModel(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.endsWith("/kokoro/onnx/model.onnx")
      || (pathname.includes("/Kokoro-82M-v1.0-ONNX/") && pathname.endsWith("/onnx/model.onnx"));
  } catch {
    return false;
  }
}

async function removeLegacyFp32Cache() {
  if (!globalThis.caches) return;
  for (const cacheName of [SHARED_MODEL_CACHE, "transformers-cache"]) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      await Promise.all(keys.filter((request) => isLegacyFp32KokoroModel(request.url)).map((request) => cache.delete(request)));
    } catch {
      // Cache cleanup is best-effort. The q8 runtime can still use the network.
    }
  }
}

async function loadRuntime(onProgress, modelArtifacts) {
  const nextModelKey = modelKey(modelArtifacts);
  if (runtimePromise && activeModelKey !== nextModelKey) runtimePromise = undefined;
  if (!runtimePromise) {
    activeModelKey = nextModelKey;
    runtimePromise = (async () => {
      // Earlier builds downloaded the 325 MB fp32 WebGPU graph before falling
      // back. It is no longer used and can prevent the 92 MB q8 model from
      // being cached when the site's storage quota is tight.
      await removeLegacyFp32Cache();
      const [{ env: transformersEnv }, { KokoroTTS }] = await Promise.all([
        import("@huggingface/transformers"),
        import("kokoro-js"),
      ]);
      const previousEnvironment = {
        useBrowserCache: transformersEnv.useBrowserCache,
        useCustomCache: transformersEnv.useCustomCache,
        customCache: transformersEnv.customCache,
        allowRemoteModels: transformersEnv.allowRemoteModels,
        remoteHost: transformersEnv.remoteHost,
        remotePathTemplate: transformersEnv.remotePathTemplate,
      };
      const hosted = configureKokoroHostModelFiles(transformersEnv, modelArtifacts);
      if (!hosted) {
        await prepareVoiceModelStorage({
          preserveModelPath: "kokoro",
          requiredBytes: 120 * 1024 * 1024,
          clearPiper: true,
        });
      }
      const modelProgress = (event) => {
        // Transformers reports each config/tokenizer/model file separately.
        // Treating a tiny JSON file's 100% as the whole download is what made
        // the previous UI jump to 86% long before the ONNX graph was ready.
        if (!String(event?.file || "").endsWith(".onnx")) return;
        if (Number.isFinite(event?.progress)) {
          onProgress?.({ ...event, progress: 10 + (Math.max(0, Math.min(100, event.progress)) * 0.78) });
        }
      };
      try {
        return await loadVoiceModelFromMirrors(transformersEnv, "kokoro", (modelId) => KokoroTTS.from_pretrained(modelId, {
          dtype: "q8",
          device: "wasm",
          progress_callback: modelProgress,
        }));
      } finally {
        if (hosted) Object.assign(transformersEnv, previousEnvironment);
      }
    })().catch((error) => {
      runtimePromise = undefined;
      activeModelKey = "";
      throw error;
    });
  }
  return runtimePromise;
}

async function fetchOwnedVoiceStyle(voiceId, originalFetch, init, modelArtifacts) {
  if (modelArtifacts && typeof modelArtifacts === "object" && Object.keys(modelArtifacts).length) {
    const artifactId = HOST_VOICE_KEYS[voiceId];
    const artifactUrl = artifactId ? modelArtifacts[artifactId] : undefined;
    if (!artifactUrl) throw new Error(`Host Kokoro model is missing voice style: ${voiceId}`);
    const response = await originalFetch(artifactUrl, init);
    if (!response.ok) throw new Error(`Host Kokoro model returned HTTP ${response.status}: ${voiceId}`);
    return response;
  }
  const candidates = await orderModelUrlsForNetwork(voiceModelFileUrls(`kokoro/voices/${voiceId}.bin`));
  const failures = [];
  for (const candidate of candidates) {
    try {
      const response = await originalFetch(candidate, init);
      if (response.ok) return response;
      failures.push(`${new URL(candidate).hostname}: HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${new URL(candidate).hostname}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`MODEL_MIRRORS_UNAVAILABLE: ${failures.join("; ")}`);
}

export async function predictKokoroVoice(input, onProgress) {
  const tts = await loadRuntime(onProgress, input.modelArtifacts);
  onProgress?.({ backend: "wasm", progress: 92 });
  // Let React paint the phase change before main-thread WASM inference starts.
  // Otherwise the last download label remains visible throughout generation.
  await new Promise((resolve) => {
    if (globalThis.requestAnimationFrame) requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

  // kokoro-js currently hard-codes its upstream voice-style URL. Intercept
  // only that one request so every runtime voice artifact comes from the
  // owned, immutable provider mirrors while retaining kokoro-js's cache key.
  const upstreamUrl = `${UPSTREAM_VOICE_PREFIX}${input.voiceId}.bin`;
  const originalFetch = globalThis.fetch;
  const mirroredFetch = (resource, init) => {
    const requestUrl = typeof resource === "string" ? resource : resource?.url;
    return requestUrl === upstreamUrl
      ? fetchOwnedVoiceStyle(input.voiceId, originalFetch, init, input.modelArtifacts)
      : originalFetch(resource, init);
  };
  globalThis.fetch = mirroredFetch;
  try {
    const audio = await tts.generate(input.text, { voice: input.voiceId, speed: input.speed });
    return audio.toBlob();
  } finally {
    if (globalThis.fetch === mirroredFetch) globalThis.fetch = originalFetch;
  }
}

export async function clearKokoroVoiceCacheIfStorageTight() {
  if (!globalThis.navigator?.storage?.estimate || !globalThis.caches) return false;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const remaining = Math.max(0, quota - usage);
    if (!quota || (usage / quota <= 0.85 && remaining >= 100 * 1024 * 1024)) return false;
    return caches.delete(KOKORO_VOICE_CACHE);
  } catch {
    return false;
  }
}

import * as ort from "onnxruntime-web/webgpu";
import ortWasmMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import { JOYVASA_WEB_MODEL } from "../config/joyVasa.js";
import { fetchFirstAvailableModel } from "../lib/modelSources.js";
import { configureOrtWebGpu } from "../lib/webGpuPreference.js";

configureOrtWebGpu(ort);
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = { mjs: ortWasmMjsUrl, wasm: ortWasmUrl };

const tensor = (data, dims) => new ort.Tensor("float32", data, dims);
const runtimePromises = new Map();
const artifactPromises = new Map();
const HOST_JOYVASA_FILES = Object.freeze({
  "joyvasa-audio.onnx.part-aa": "audio-aa",
  "joyvasa-audio.onnx.part-ab": "audio-ab",
  "joyvasa-audio.onnx.part-ac": "audio-ac",
  "joyvasa-audio.onnx.part-ad": "audio-ad",
  "joyvasa-audio.onnx.part-ae": "audio-ae",
  "joyvasa-audio.onnx.part-af": "audio-af",
  "joyvasa-audio.onnx.part-ag": "audio-ag",
  "joyvasa-audio.onnx.part-ah": "audio-ah",
  "joyvasa-denoiser.onnx": "denoiser",
  "joyvasa-conditioning.bin": "conditioning",
  "joyvasa-schedule.bin": "schedule",
});

function progress(value, phaseKey, phaseParams = {}) {
  self.postMessage({ type: "progress", progress: Math.round(value), phaseKey, phaseParams });
}

function modelUrl(file, baseUrl) {
  if (!baseUrl) throw new Error("JoyVASA 浏览器模型包尚未配置托管地址");
  return new URL(file, new URL(baseUrl, self.location.origin)).href;
}

function modelBaseUrls(value) {
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function hasHostModelArtifacts(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
}

async function fetchModelFile(file, baseUrls, hostModelArtifacts) {
  if (hasHostModelArtifacts(hostModelArtifacts)) {
    const artifactId = HOST_JOYVASA_FILES[file];
    const artifactUrl = artifactId && hostModelArtifacts[artifactId];
    if (!artifactUrl) throw new Error(`Host JoyVASA model is missing artifact: ${file}`);
    const response = await fetch(artifactUrl);
    if (!response.ok) throw new Error(`Host JoyVASA model returned HTTP ${response.status}: ${file}`);
    return response;
  }
  const urls = modelBaseUrls(baseUrls).map((baseUrl) => modelUrl(file, baseUrl));
  try {
    const { response } = await fetchFirstAvailableModel(urls);
    return response;
  } catch (error) {
    throw new Error(`${file} 下载失败（${error?.message || String(error)}）`, { cause: error });
  }
}

async function fetchArtifact(key, baseUrl, start, span, hostModelArtifacts) {
  const configuredFiles = JOYVASA_WEB_MODEL.files[key];
  const files = Array.isArray(configuredFiles) ? configuredFiles : [configuredFiles];
  const total = JOYVASA_WEB_MODEL.knownArtifacts[key].bytes;
  let loaded = 0;
  const parts = await Promise.all(files.map(async (file) => {
    const response = await fetchModelFile(file, baseUrl, hostModelArtifacts);
    const reader = response.body?.getReader();
    if (!reader) {
      const part = new Uint8Array(await response.arrayBuffer());
      loaded += part.byteLength;
      progress(start + Math.min(1, loaded / total) * span, "avatarProgressDownloadFile", { file });
      return part;
    }
    const chunks = [];
    let partBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      partBytes += value.byteLength;
      loaded += value.byteLength;
      progress(start + Math.min(1, loaded / total) * span, "avatarProgressDownloadFile", { file });
    }
    const part = new Uint8Array(partBytes);
    let offset = 0;
    for (const chunk of chunks) {
      part.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return part;
  }));
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return combined.buffer;
}

async function createSession(key, bytes) {
  if (!self.navigator?.gpu) throw new Error(`当前浏览器没有可用的 WebGPU，无法运行 JoyVASA ${key}`);
  return ort.InferenceSession.create(bytes, {
    executionProviders: [{ name: "webgpu", preferredLayout: "NHWC" }],
    graphOptimizationLevel: "all",
  });
}

function getRuntime(modelBaseUrl, hostModelArtifacts) {
  const runtimeKey = JSON.stringify(hasHostModelArtifacts(hostModelArtifacts) ? hostModelArtifacts : modelBaseUrls(modelBaseUrl));
  if (runtimePromises.has(runtimeKey)) return runtimePromises.get(runtimeKey);
  const promise = (async () => {
    let artifacts = artifactPromises.get(runtimeKey);
    if (!artifacts) {
      artifacts = Promise.all([
        fetchArtifact("audio", modelBaseUrl, 2, 47, hostModelArtifacts),
        fetchArtifact("denoiser", modelBaseUrl, 49, 12, hostModelArtifacts),
        fetchArtifact("conditioning", modelBaseUrl, 61, 1, hostModelArtifacts),
        fetchArtifact("schedule", modelBaseUrl, 62, 1, hostModelArtifacts),
      ]).catch((error) => {
        artifactPromises.delete(runtimeKey);
        throw error;
      });
      artifactPromises.set(runtimeKey, artifacts);
    }
    const [audioBytes, denoiserBytes, conditioningBytes, scheduleBytes] = await artifacts;
    progress(63, "avatarProgressInitHubert");
    const audioSession = await createSession("audio", audioBytes);
    progress(65, "avatarProgressInitMotion");
    const denoiserSession = await createSession("denoiser", denoiserBytes);
    return {
      audioSession,
      denoiserSession,
      conditioning: new Float32Array(conditioningBytes),
      schedule: new Float32Array(scheduleBytes),
    };
  })().catch((error) => {
    runtimePromises.delete(runtimeKey);
    throw error;
  });
  runtimePromises.set(runtimeKey, promise);
  return promise;
}

function reflectPadOnce(input, amount) {
  const output = new Float32Array(input.length + amount * 2);
  output.set(input, amount);
  for (let i = 0; i < amount; i += 1) {
    output[amount - 1 - i] = input[i + 1];
    output[amount + input.length + i] = input[input.length - 2 - i];
  }
  return output;
}

function prepareWindow(samples) {
  const source = new Float32Array(64_000);
  source.set(samples.subarray(0, Math.min(samples.length, source.length)));
  // Exact equivalent of JoyVASA pad_audio for a 64,000-sample window:
  // reflect-pad 20 samples twice, producing 64,080 samples.
  return reflectPadOnce(reflectPadOnce(source, 20), 20);
}

function makeGaussian(seed = 0x6a09e667) {
  let state = seed >>> 0;
  let spare = null;
  const uniform = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 1) / 4294967297;
  };
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = Math.PI * 2 * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

function randomNormal(length, gaussian) {
  const values = new Float32Array(length);
  for (let i = 0; i < length; i += 1) values[i] = gaussian();
  return values;
}

function repeatRows(values, rows, width) {
  const output = new Float32Array(rows * width);
  for (let row = 0; row < rows; row += 1) output.set(values, row * width);
  return output;
}

async function sampleMotion(denoiser, audioFeatures, conditioning, schedule) {
  const startAudio = conditioning.subarray(0, 2560);
  const startMotion = conditioning.subarray(2560, 3290);
  const nullAudio = conditioning.subarray(3290, 3546);
  const audioBatch = new Float32Array(2 * 100 * 256);
  audioBatch.set(repeatRows(nullAudio, 100, 256), 0);
  audioBatch.set(audioFeatures, 100 * 256);
  const previousMotion = new Float32Array(2 * 10 * 73);
  previousMotion.set(startMotion, 0);
  previousMotion.set(startMotion, startMotion.length);
  const previousAudio = new Float32Array(2 * 10 * 256);
  previousAudio.set(startAudio, 0);
  previousAudio.set(startAudio, startAudio.length);
  const gaussian = makeGaussian();
  let motion = randomNormal(100 * 73, gaussian);

  for (let step = 50; step >= 1; step -= 1) {
    const motionBatch = new Float32Array(motion.length * 2);
    motionBatch.set(motion, 0);
    motionBatch.set(motion, motion.length);
    const result = await denoiser.run({
      motion: tensor(motionBatch, [2, 100, 73]),
      audio: tensor(audioBatch, [2, 100, 256]),
      previous_motion: tensor(previousMotion, [2, 10, 73]),
      previous_audio: tensor(previousAudio, [2, 10, 256]),
      step: new ort.Tensor("int64", BigInt64Array.from([BigInt(step), BigInt(step)]), [2]),
    });
    const prediction = result.motion_prediction.data;
    const target = new Float32Array(motion.length);
    const unconditionalOffset = 10 * 73;
    const conditionalOffset = 110 * 73 + unconditionalOffset;
    for (let i = 0; i < target.length; i += 1) {
      const base = prediction[unconditionalOffset + i];
      target[i] = base + 1.15 * (prediction[conditionalOffset + i] - base);
    }
    const alpha = schedule[step * 2];
    const alphaBar = schedule[step * 2 + 1];
    const alphaBarPrevious = schedule[(step - 1) * 2 + 1];
    const beta = 1 - alpha;
    const c0 = ((1 - alphaBarPrevious) * Math.sqrt(alpha)) / (1 - alphaBar);
    const c1 = (beta * Math.sqrt(alphaBarPrevious)) / (1 - alphaBar);
    const sigma = Math.sqrt(((1 - alphaBarPrevious) / (1 - alphaBar)) * beta);
    const noise = step > 1 ? randomNormal(motion.length, gaussian) : null;
    const next = new Float32Array(motion.length);
    for (let i = 0; i < next.length; i += 1) next[i] = c0 * motion[i] + c1 * target[i] + (noise ? sigma * noise[i] : 0);
    motion = next;
    progress(66 + ((51 - step) / 50) * 32, "avatarProgressMotionStep", { current: 51 - step, total: 50 });
  }
  return motion;
}

async function generate({ audioSamples, modelBaseUrl, modelArtifacts: hostModelArtifacts }) {
  progress(1, "avatarProgressPrepareAudio");
  const runtime = await getRuntime(modelBaseUrl, hostModelArtifacts);
  const window = prepareWindow(new Float32Array(audioSamples));
  const audioResult = await runtime.audioSession.run({ audio_padded: tensor(window, [1, 64_080]) });
  progress(66, "avatarProgressAudioReady");
  const motion = await sampleMotion(
    runtime.denoiserSession,
    audioResult.audio_features.data,
    runtime.conditioning,
    runtime.schedule,
  );
  progress(100, "avatarProgressMotionReady");
  self.postMessage({ type: "motion", motion: motion.buffer, frames: 100, fps: 25 }, [motion.buffer]);
}

async function prepare({ modelBaseUrl, modelArtifacts: hostModelArtifacts }) {
  await getRuntime(modelBaseUrl, hostModelArtifacts);
  self.postMessage({ type: "prepared" });
}

async function release({ modelBaseUrl, modelArtifacts: hostModelArtifacts }) {
  const runtimeKey = JSON.stringify(hasHostModelArtifacts(hostModelArtifacts) ? hostModelArtifacts : modelBaseUrls(modelBaseUrl));
  const promise = runtimePromises.get(runtimeKey);
  if (promise) {
    const runtime = await promise;
    runtime.audioSession.release();
    runtime.denoiserSession.release();
    runtimePromises.delete(runtimeKey);
  }
  self.postMessage({ type: "released" });
}

self.onmessage = (event) => {
  const task = event.data?.type === "generate"
    ? generate
    : event.data?.type === "prepare"
      ? prepare
      : event.data?.type === "release"
        ? release
        : null;
  if (!task) return;
  task(event.data).catch((error) => {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
};

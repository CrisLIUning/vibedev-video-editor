import { orderModelUrlsForNetwork } from "../lib/modelSources.js";

const MODEL_REVISION = "927cd9272154b85c53518daf44063ee033ee22c3";
const HUGGING_FACE_MODEL_URL =
  `https://huggingface.co/haixin/timeline-studio-vocal-remover/resolve/${MODEL_REVISION}/model.json`;
const MODEL_SCOPE_MODEL_URL =
  `https://www.modelscope.cn/models/martindelophy/timeline-studio-vocal-remover/resolve/${MODEL_REVISION}/model.json`;
const CHUNK_SIZE = 31744;
const PADDING = 3072;
const FFT_SIZE = 6144;
const HOP_SIZE = 1024;

let modelPromise;
let runtimePromise;
let activeBackend = "webgl";

function postProgress(requestId, progress, phase) {
  self.postMessage({ type: "progress", requestId, progress, phase });
}

async function getRuntime() {
  runtimePromise ??= (async () => {
    try {
      importScripts("/vendor/vocal-remover/tf.min.js?v=4.22.0");
      if (self.navigator.gpu) importScripts("/vendor/vocal-remover/tf-backend-webgpu.js?v=4.22.0");
    } catch {
      throw new Error("VOCAL_RUNTIME_DOWNLOAD_FAILED");
    }
    return self.tf;
  })();
  return runtimePromise;
}

function modelUrls(preference) {
  return preference === "modelscope"
    ? [MODEL_SCOPE_MODEL_URL, HUGGING_FACE_MODEL_URL]
    : [HUGGING_FACE_MODEL_URL, MODEL_SCOPE_MODEL_URL];
}

async function getModel(runtime, modelSourcePreference, modelUrl = "") {
  modelPromise ??= (async () => {
    const requestedBackend = self.navigator.gpu && runtime.findBackend("webgpu") ? "webgpu" : "webgl";
    let ready;
    try { ready = await runtime.setBackend(requestedBackend); } catch { ready = false; }
    if (!ready && requestedBackend === "webgpu") ready = await runtime.setBackend("webgl");
    if (!ready) throw new Error("VOCAL_BACKEND_UNAVAILABLE");
    activeBackend = runtime.getBackend();
    await runtime.ready();
    if (modelUrl) return runtime.loadGraphModel(modelUrl);
    const failures = [];
    const candidates = await orderModelUrlsForNetwork(modelUrls(modelSourcePreference));
    for (const url of candidates) {
      try {
        return await runtime.loadGraphModel(url);
      } catch (error) {
        failures.push(`${new URL(url).hostname}: ${error?.message || String(error)}`);
      }
    }
    throw new Error(`VOCAL_MODEL_FAILED: ${failures.join("; ")}`);
  })();
  return modelPromise;
}

function stft(runtime, input) {
  return runtime.tidy(() => {
    const spectrum = runtime.signal.stft(input, FFT_SIZE, HOP_SIZE, FFT_SIZE, (length) => runtime.signal.hannWindow(length));
    const real = runtime.real(spectrum).slice([0, 0], [32, 3072]).transpose();
    const imag = runtime.imag(spectrum).slice([0, 0], [32, 3072]).transpose();
    const output = runtime.stack([real, imag], 0);
    return runtime.where(runtime.isNaN(output), runtime.zerosLike(output), output);
  });
}

function createHannWindow() {
  const window = new Float32Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / FFT_SIZE);
  }
  return window;
}

const hannWindow = createHannWindow();

async function inverseChannel(runtime, spectrogram) {
  const frames = spectrogram.shape[1];
  const timeFrames = runtime.tidy(() => {
    const frameMajor = spectrogram.transpose([1, 0, 2]);
    const real = frameMajor.slice([0, 0, 0], [-1, -1, 1]).squeeze([2]);
    const imag = frameMajor.slice([0, 0, 1], [-1, -1, 1]).squeeze([2]);
    return runtime.spectral.irfft(runtime.complex(real, imag));
  });
  const samples = await timeFrames.data();
  timeFrames.dispose();

  const output = new Float32Array(FFT_SIZE + HOP_SIZE * (frames - 1));
  const weights = new Float32Array(output.length);
  for (let frame = 0; frame < frames; frame += 1) {
    const sourceOffset = frame * FFT_SIZE;
    const outputOffset = frame * HOP_SIZE;
    for (let cursor = 0; cursor < FFT_SIZE; cursor += 1) {
      output[outputOffset + cursor] += samples[sourceOffset + cursor] * hannWindow[cursor];
      weights[outputOffset + cursor] += hannWindow[cursor] ** 2;
    }
  }
  // Analysis and synthesis both use Hann windows. Normalize their overlap;
  // dividing by a fixed gain would still damage the partially covered edges.
  for (let index = 0; index < output.length; index += 1) {
    if (weights[index] > 1e-8) output[index] /= weights[index];
  }
  return output;
}

async function istft(runtime, tensor) {
  const padded = runtime.pad(tensor, [[0, 0], [0, 0], [0, 1], [0, 0]]);
  const shaped = padded.reshape([2, 2, 3073, 32]).transpose([0, 2, 3, 1]);
  const left = shaped.slice([0, 0, 0, 0], [1, -1, -1, -1]).squeeze([0]);
  const right = shaped.slice([1, 0, 0, 0], [1, -1, -1, -1]).squeeze([0]);
  try {
    return await Promise.all([inverseChannel(runtime, left), inverseChannel(runtime, right)]);
  } finally {
    runtime.dispose([padded, shaped, left, right]);
  }
}

function wavBuffer(channels, sampleRate) {
  const frames = channels[0].length;
  if (channels.length !== 2 || channels[1].length !== frames) throw new Error("VOCAL_OUTPUT_INVALID");
  // Intermediate stems may exceed full scale while their sum does not. Float
  // WAV preserves those samples instead of permanently clipping either stem.
  const buffer = new ArrayBuffer(56 + frames * 8);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  text(36, "fact"); view.setUint32(40, 4, true); view.setUint32(44, frames, true);
  text(48, "data"); view.setUint32(52, frames * 8, true);
  let offset = 56;
  for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < 2; channel += 1) {
    const sample = channels[channel][frame];
    if (!Number.isFinite(sample)) throw new Error("VOCAL_OUTPUT_INVALID");
    view.setFloat32(offset, sample, true); offset += 4;
  }
  return buffer;
}

async function separate(requestId, left, right, sampleRate, modelSourcePreference, modelUrl = "") {
  if (!left.length || left.length !== right.length || sampleRate !== 44100
    || !left.every(Number.isFinite) || !right.every(Number.isFinite)) throw new Error("VOCAL_INPUT_INVALID");
  const runtime = await getRuntime();
  postProgress(requestId, 4, { key: "vocalSeparationLoadingModel" });
  const model = await getModel(runtime, modelSourcePreference, modelUrl);
  postProgress(requestId, 7, { key: activeBackend === "webgpu" ? "vocalSeparationUsingWebGpu" : "vocalSeparationUsingWebGl" });
  const sources = [left, right];
  const accompaniment = sources.map(source => new Float32Array(source.length));
  const vocals = sources.map(source => new Float32Array(source.length));
  const chunks = Math.ceil(left.length / CHUNK_SIZE);
  for (let index = 0; index < chunks; index += 1) {
    const start = index * CHUNK_SIZE;
    const valid = Math.min(CHUNK_SIZE, left.length - start);
    // Keep actual neighboring audio at chunk boundaries. Only pad outside the
    // requested clip; never read past the caller's already-trimmed audio.
    const padded = sources.map(source => {
      const buffer = new Float32Array(CHUNK_SIZE + PADDING * 2);
      const from = Math.max(0, start - PADDING);
      const to = Math.min(source.length, start + CHUNK_SIZE + PADDING);
      buffer.set(source.subarray(from, to), from - start + PADDING);
      return buffer;
    });
    const input = runtime.tidy(() => {
      const l = stft(runtime, runtime.tensor1d(padded[0]));
      const r = stft(runtime, runtime.tensor1d(padded[1]));
      // Model and inverse both read [L real, L imaginary, R real, R imaginary].
      return runtime.stack([l, r], 0).reshape([1, 4, 3072, 32]);
    });
    let musicTensor;
    try {
      musicTensor = model.predict(input);
      const music = await istft(runtime, musicTensor);
      for (let channel = 0; channel < 2; channel += 1) {
        for (let index = 0; index < valid; index += 1) {
          const value = music[channel][PADDING + index];
          if (!Number.isFinite(value)) throw new Error("VOCAL_OUTPUT_INVALID");
          accompaniment[channel][start + index] = value;
          // The waveform residual retains input frequencies omitted by the
          // model and guarantees that both stems reconstruct the source mix.
          vocals[channel][start + index] = sources[channel][start + index] - value;
        }
      }
    } finally {
      runtime.dispose([input, musicTensor]);
    }
    postProgress(requestId, 8 + Math.round(((index + 1) / chunks) * 88), {
      key: "vocalSeparationProcessingChunk", current: index + 1, total: chunks,
    });
  }
  const vocalsBuffer = wavBuffer(vocals, sampleRate);
  const accompanimentBuffer = wavBuffer(accompaniment, sampleRate);
  self.postMessage(
    { type: "result", requestId, vocalsBuffer, accompanimentBuffer, backend: activeBackend },
    [vocalsBuffer, accompanimentBuffer],
  );
}

self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "separate") return;
  try {
    await separate(
      data.requestId,
      new Float32Array(data.leftBuffer),
      new Float32Array(data.rightBuffer),
      data.sampleRate,
      data.modelSourcePreference,
      data.modelUrl,
    );
  } catch (error) {
    self.postMessage({ type: "error", requestId: data.requestId, error: error?.message || "VOCAL_MODEL_FAILED" });
  }
});

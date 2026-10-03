let worker;
const pending = new Map();
const SAMPLE_RATE = 22050;
export const OPENVOICE_EMBEDDING_VERSION = 2;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("../workers/openvoice.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.requestId);
      if (!task) return;
      if (data.type === "progress") return task.onProgress?.(data);
      pending.delete(data.requestId);
      if (data.type === "error") task.reject(new Error(data.message));
      else task.resolve(data.result);
    };
  }
  return worker;
}

async function decodeMono(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Context || !Offline) throw new Error("当前浏览器不支持本地音频解码");
  const decoder = new Context();
  try {
    const source = await decoder.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const length = Math.max(1, Math.ceil(source.duration * SAMPLE_RATE));
    const offline = new Offline(1, length, SAMPLE_RATE);
    const node = offline.createBufferSource(); node.buffer = source; node.connect(offline.destination); node.start();
    const rendered = await offline.startRendering();
    return Float32Array.from(rendered.getChannelData(0));
  } finally { await decoder.close(); }
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
  return new Blob([buffer], { type: "audio/wav" });
}

async function run(action, blob, options = {}) {
  await globalThis.navigator?.storage?.persist?.().catch(() => false);
  options.signal?.throwIfAborted();
  const samples = await decodeMono(blob);
  options.signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const abort = () => cancelOpenVoiceTasks();
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    options.signal?.addEventListener("abort", abort, { once: true });
    pending.set(requestId, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); }, onProgress: options.onProgress });
    const payload = { requestId, action, samples, embedding: options.embedding, seed: options.seed };
    const transfers = [samples.buffer];
    if (options.embedding) payload.embedding = Float32Array.from(options.embedding);
    getWorker().postMessage(payload, transfers);
  });
}

export async function extractVoiceEmbedding(blob, onProgress, options = {}) {
  return run("encode", blob, { ...options, onProgress });
}

export async function convertVoiceBlob(blob, embedding, { onProgress, seed = 2026, signal } = {}) {
  const samples = await run("convert", blob, { embedding, onProgress, seed, signal });
  return encodeWav(samples);
}

export async function applyVoiceOutputGain(blob, gain = 1) {
  const safeGain = Math.max(0, Math.min(4, Number(gain) || 0));
  if (Math.abs(safeGain - 1) < 0.001) return blob;
  const samples = await decodeMono(blob);
  const limiterDrive = 1.35;
  const limiterCeiling = Math.tanh(limiterDrive);
  for (let index = 0; index < samples.length; index += 1) {
    const amplified = samples[index] * safeGain;
    samples[index] = Math.tanh(amplified * limiterDrive) / limiterCeiling;
  }
  return encodeWav(samples);
}

export function cancelOpenVoiceTasks() {
  worker?.terminate(); worker = null;
  for (const task of pending.values()) task.reject(new DOMException("已取消声音转换", "AbortError"));
  pending.clear();
}

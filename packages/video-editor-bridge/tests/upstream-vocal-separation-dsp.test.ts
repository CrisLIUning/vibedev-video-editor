import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import workerSource from '../../../vendor/ai-video-editor/src/workers/vocal-separation.worker.js?raw';

// Use the shipped TensorFlow for tensor layout. FFT/GPU accuracy is checked by
// the real-browser witness; the inverse test supplies analytically windowed frames.
const moduleStub = { exports: {} as any };
runInNewContext(readFileSync(new URL('../../../vendor/ai-video-editor/public/vendor/vocal-remover/tf.min.js', import.meta.url), 'utf8'), {
  module: moduleStub, exports: moduleStub.exports, require: createRequire(import.meta.url),
  console: { ...console, warn() {} }, process, setTimeout, clearTimeout, TextEncoder, TextDecoder,
  performance, Float32Array, Int32Array, Uint8Array,
});
const tf = moduleStub.exports;
function worker(extra = '') {
  const messages: any[] = [];
  const self: any = { addEventListener() {}, postMessage(value: any) { messages.push(value); } };
  // Plain \n first: on a Windows (CRLF) checkout the import line would survive.
  runInNewContext(workerSource.replace(/\r\n/g, '\n').replace(/^import .*;\n/, '') + `
    self.api = { inverseChannel, separate, wavBuffer, FFT_SIZE, HOP_SIZE, CHUNK_SIZE, PADDING,
      configure(runtime, model) { runtimePromise = Promise.resolve(runtime); modelPromise = Promise.resolve(model); } };
    ${extra}
  `, { self, Float32Array, Float64Array, ArrayBuffer, DataView, URL, console });
  return { ...self.api, messages };
}

describe('vocal separation signal contract', () => {
  it('normalizes overlapping Hann windows, including the partially covered clip edges', async () => {
    const w = worker(), n = w.FFT_SIZE, hop = w.HOP_SIZE, frames = 32;
    const original = Float32Array.from({ length: n + hop * (frames - 1) }, (_, i) => .2 * Math.sin(i * .17));
    const timeFrames = Float32Array.from({ length: frames * n }, (_, i) => original[Math.floor(i / n) * hop + i % n]! * (.5 - .5 * Math.cos(2 * Math.PI * (i % n) / n)));
    const spectrum = tf.zeros([3073, frames, 2]);
    const runtime = { ...tf, spectral: { irfft: () => tf.tensor2d(timeFrames, [frames, n]) } };
    const restored = await w.inverseChannel(runtime, spectrum); spectrum.dispose();
    let maxError = 0;
    for (let i = w.PADDING; i < original.length - w.PADDING; i++) maxError = Math.max(maxError, Math.abs(restored[i] - original[i]!));
    expect(maxError).toBeLessThan(1e-6);
  });

  it('packs L-real/L-imag/R-real/R-imag and keeps source context across chunks', async () => {
    const w = worker(`
      stft = (runtime, input) => runtime.stack([
        runtime.fill([3072,32], input.dataSync()[PADDING]),
        runtime.fill([3072,32], input.dataSync()[PADDING] + 1),
      ], 0);
      istft = async () => [new Float32Array(CHUNK_SIZE + PADDING * 2), new Float32Array(CHUNK_SIZE + PADDING * 2)];
    `);
    const planes: number[][] = [], contexts: number[][] = [];
    const runtime = { ...tf, tensor1d: (values: Float32Array) => { contexts.push([values[0]!, values[3071]!, values[3072]!]); return tf.tensor1d(values); } };
    w.configure(runtime, { predict(input: any) { planes.push(Array.from(input.dataSync()).filter((_, i) => i % (3072 * 32) === 0) as number[]); return tf.zerosLike(input); } });
    const left = new Float32Array(w.CHUNK_SIZE + 20).fill(.1), right = new Float32Array(left.length).fill(.3);
    await w.separate('fixture', left, right, 44100, 'huggingface', 'fixture');
    expect(planes[0]).toEqual([expect.closeTo(.1), expect.closeTo(1.1), expect.closeTo(.3), expect.closeTo(1.3)]);
    expect(contexts[2]).toEqual([expect.closeTo(.1), expect.closeTo(.1), expect.closeTo(.1)]);
  });

  it('preserves the original waveform as the residual and rejects invalid predictions before posting results', async () => {
    const w = worker(`stft = runtime => runtime.zeros([2,3072,32]); istft = async () => [new Float32Array(CHUNK_SIZE + PADDING * 2).fill(.2), new Float32Array(CHUNK_SIZE + PADDING * 2).fill(.2)];`);
    w.configure(tf, { predict: (input: any) => tf.zerosLike(input) });
    const left = Float32Array.from({ length: 31747 }, (_, i) => i % 2 ? .9 : -.9);
    const right = new Float32Array(left.length);
    await w.separate('fixture', left, right, 44100, 'huggingface', 'fixture');
    const result = w.messages.find((message: any) => message.type === 'result');
    const voice = new DataView(result.vocalsBuffer), music = new DataView(result.accompanimentBuffer);
    for (const i of [0, 31743, 31744, 31746]) {
      expect(voice.getFloat32(56 + i * 8, true) + music.getFloat32(56 + i * 8, true)).toBeCloseTo(left[i]!, 6);
      expect(voice.getFloat32(60 + i * 8, true) + music.getFloat32(60 + i * 8, true)).toBeCloseTo(0, 6);
    }
    const invalid = worker(`stft = runtime => runtime.zeros([2,3072,32]); istft = async () => [new Float32Array(CHUNK_SIZE + PADDING * 2).fill(NaN), new Float32Array(CHUNK_SIZE + PADDING * 2)];`);
    invalid.configure(tf, { predict: (input: any) => tf.zerosLike(input) });
    const before = tf.memory().numTensors;
    await expect(invalid.separate('fixture', left, right, 44100, 'huggingface', 'fixture')).rejects.toThrow('VOCAL_OUTPUT_INVALID');
    expect(invalid.messages.some((message: any) => message.type === 'result')).toBe(false);
    expect(tf.memory().numTensors).toBe(before);
  });

  it('writes finite float PCM without clipping the separated waveform', () => {
    const w = worker();
    const buffer = w.wavBuffer([new Float32Array([1.2, -.25]), new Float32Array([-.7, -1.1])], 44100);
    const data = new DataView(buffer);
    expect(data.getUint16(20, true)).toBe(3);
    expect(data.getUint16(34, true)).toBe(32);
    expect(data.getFloat32(56, true)).toBeCloseTo(1.2);
    expect(data.getFloat32(68, true)).toBeCloseTo(-1.1);
    expect(() => w.wavBuffer([new Float32Array([NaN]), new Float32Array([0])], 44100)).toThrow();
  });
});

import * as ort from '@vibedev/whisper-ort';
import mjs from '@vibedev/whisper-ort-mjs?url';
import wasm from '@vibedev/whisper-ort-wasm?url';
import {speechRegions} from './speechRegions.js';
/** Silero v6.2.1 stateful 16kHz contract; this detects speech-like sound, not semantic correctness. */
export async function detectSpeech(audio, modelUrl) {
  if (!modelUrl) throw new Error('CAPTION_VAD_MODEL_MISSING: prepare silero-vad before recognition');
  ort.env.wasm.wasmPaths = {mjs, wasm}; ort.env.wasm.numThreads = 1;
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error('CAPTION_VAD_MODEL_UNAVAILABLE');
  const session = await ort.InferenceSession.create(await response.arrayBuffer(), {executionProviders:['wasm']});
  const probabilities = []; let state = new Float32Array(256); let context = new Float32Array(64);
  try {
    for (let offset = 0; offset < audio.length; offset += 512) {
      const input = new Float32Array(576); input.set(context); input.set(audio.subarray(offset, offset + 512),64);
      const out = await session.run({input:new ort.Tensor('float32',input,[1,576]),state:new ort.Tensor('float32',state,[2,1,128]),sr:new ort.Tensor('int64',BigInt64Array.of(16000n),[])});
      probabilities.push(Number(out.output.data[0])); state = new Float32Array(out.stateN.data); context = input.slice(-64);
    }
  } finally { await session.release(); }
  return {model:'silero-vad-v6.2.1',frameSeconds:0.032,probabilities,regions:speechRegions(probabilities,audio.length/16000),classification:'speech-likelihood-not-dialogue-verification'};
}

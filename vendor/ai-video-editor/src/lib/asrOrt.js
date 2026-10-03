import mjs from '@vibedev/whisper-ort-mjs?url';
import wasm from '@vibedev/whisper-ort-wasm?url';
export function configureWhisperOrt(env) {
  env.backends.onnx.wasm.wasmPaths = {mjs, wasm};
  env.backends.onnx.wasm.numThreads = 1;
}

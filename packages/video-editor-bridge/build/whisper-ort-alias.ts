import { createRequire } from 'node:module';
import path from 'node:path';
/** Resolve assets from the exact ONNX runtime used by Transformers, not the editor's newer ORT. */
export function whisperOrtAliases(vendorRoot: string) {
  const require = createRequire(path.join(vendorRoot, 'package.json'));
  const transformers = require.resolve('@huggingface/transformers');
  const ort = createRequire(transformers).resolve('onnxruntime-web');
  const dist = path.dirname(ort);
  return [
    { find: /^@vibedev\/whisper-ort-mjs(?=\?|$)/, replacement: path.join(dist, 'ort-wasm-simd-threaded.jsep.mjs') },
    { find: /^@vibedev\/whisper-ort-wasm(?=\?|$)/, replacement: path.join(dist, 'ort-wasm-simd-threaded.jsep.wasm') },
    { find: /^@vibedev\/whisper-ort$/, replacement: path.join(dist, 'ort.webgpu.mjs') },
  ];
}

export function mapAiMusicWorkerProgress(progress, hostedRuntime = false) {
  const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
  return hostedRuntime && normalized < 0.64
    ? 0.58 + (normalized / 0.64) * 0.06
    : normalized;
}

export function advanceAiMusicProgress(currentProgress, workerProgress, hostedRuntime = false) {
  return Math.max(Number(currentProgress) || 0, mapAiMusicWorkerProgress(workerProgress, hostedRuntime));
}

export async function resolveAiMusicExecutionProviders(navigatorLike = globalThis.navigator) {
  // Chromium's D3D12 WebGPU device can be removed during the long MusicGen
  // inference pass in the packaged Windows shell. ONNX cannot recover an
  // already-created WebGPU session by listing WASM second, so choose the
  // deterministic WASM runtime up front on Windows.
  if (/Windows NT/i.test(String(navigatorLike?.userAgent || ""))) return ["wasm"];
  const gpu = navigatorLike?.gpu;
  if (!gpu?.requestAdapter) return ["wasm"];
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    return adapter ? ["webgpu", "wasm"] : ["wasm"];
  } catch {
    return ["wasm"];
  }
}

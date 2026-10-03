export const HIGH_PERFORMANCE_WEBGPU_OPTIONS = Object.freeze({
  powerPreference: "high-performance",
  forceFallbackAdapter: false,
});

export function configureOrtWebGpu(ort) {
  if (!ort?.env?.webgpu) return;
  ort.env.webgpu.powerPreference = HIGH_PERFORMANCE_WEBGPU_OPTIONS.powerPreference;
  ort.env.webgpu.forceFallbackAdapter = HIGH_PERFORMANCE_WEBGPU_OPTIONS.forceFallbackAdapter;
}

// ONNX Runtime Web 1.16 does not expose adapter preferences and calls
// requestAdapter() without options. Keep this compatibility shim scoped to the
// worker that still needs that runtime, and preserve any explicit caller choice.
export function installHighPerformanceAdapterDefault(gpu = globalThis.navigator?.gpu) {
  if (!gpu?.requestAdapter || gpu.requestAdapter.__timelineStudioHighPerformanceDefault) return true;

  const requestAdapter = gpu.requestAdapter;
  const preferredRequestAdapter = function requestHighPerformanceAdapter(options = {}) {
    return requestAdapter.call(this, {
      ...options,
      powerPreference: options.powerPreference ?? HIGH_PERFORMANCE_WEBGPU_OPTIONS.powerPreference,
      forceFallbackAdapter: options.forceFallbackAdapter ?? HIGH_PERFORMANCE_WEBGPU_OPTIONS.forceFallbackAdapter,
    });
  };
  Object.defineProperty(preferredRequestAdapter, "__timelineStudioHighPerformanceDefault", { value: true });

  try {
    Object.defineProperty(gpu, "requestAdapter", {
      configurable: true,
      value: preferredRequestAdapter,
    });
    return true;
  } catch {
    return false;
  }
}

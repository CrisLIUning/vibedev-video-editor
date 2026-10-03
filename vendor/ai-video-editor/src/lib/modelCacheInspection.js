const MODEL_CACHE_NAME_PATTERN = /model|transformers|onnx|migan|nanovsr|voice|kokoro|piper/i;

export function formatStorageBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export async function inspectModelCache() {
  if (typeof caches === "undefined" || typeof caches.keys !== "function") {
    throw new Error("CACHE_STORAGE_UNAVAILABLE");
  }
  const names = await caches.keys();
  const modelCacheNames = names.filter((name) => MODEL_CACHE_NAME_PATTERN.test(name));
  const entryCounts = await Promise.all(modelCacheNames.map(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).length;
  }));
  let usage = null;
  let quota = null;
  if (globalThis.navigator?.storage?.estimate) {
    const estimate = await globalThis.navigator.storage.estimate();
    usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
    quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
  }
  return {
    cacheCount: modelCacheNames.length,
    entryCount: entryCounts.reduce((total, count) => total + count, 0),
    usage,
    quota,
  };
}

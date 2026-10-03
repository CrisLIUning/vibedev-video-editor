const SHARED_MODEL_CACHE = "timeline-studio-model-cache-v5";
const KOKORO_VOICE_CACHE = "kokoro-voices";
const VOICE_REPOSITORY_MARKER = "timeline-studio-voice-models";

function requestBelongsToVoiceRepository(request) {
  try {
    return new URL(request.url).pathname.includes(VOICE_REPOSITORY_MARKER);
  } catch {
    return false;
  }
}

function requestMatchesModelPath(request, modelPath) {
  if (!modelPath) return false;
  try {
    const pathname = new URL(request.url).pathname;
    return pathname.includes(`/${modelPath}/`) || pathname.endsWith(`/${modelPath}`);
  } catch {
    return false;
  }
}

async function storageIsTight(requiredBytes) {
  if (!globalThis.navigator?.storage?.estimate) return false;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota > 0 && (usage / quota > 0.85 || quota - usage < requiredBytes);
  } catch {
    return false;
  }
}

async function removeOtherSharedVoiceModels(preserveModelPath) {
  if (!globalThis.caches) return false;
  try {
    const cache = await caches.open(SHARED_MODEL_CACHE);
    const keys = await cache.keys();
    const staleKeys = keys.filter((request) => (
      requestBelongsToVoiceRepository(request)
      && !requestMatchesModelPath(request, preserveModelPath)
    ));
    const results = await Promise.all(staleKeys.map((request) => cache.delete(request)));
    return results.some(Boolean);
  } catch {
    return false;
  }
}

async function removePiperDirectory() {
  if (!globalThis.navigator?.storage?.getDirectory) return false;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("piper", { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function prepareVoiceModelStorage({
  preserveModelPath = "",
  requiredBytes = 128 * 1024 * 1024,
  clearPiper = false,
  keepKokoroStyles = preserveModelPath === "kokoro",
} = {}) {
  await globalThis.navigator?.storage?.persist?.().catch(() => false);
  if (!await storageIsTight(requiredBytes)) return false;

  const cleanupResults = await Promise.all([
    removeOtherSharedVoiceModels(preserveModelPath),
    !keepKokoroStyles && globalThis.caches
      ? caches.delete(KOKORO_VOICE_CACHE).catch(() => false)
      : false,
    clearPiper ? removePiperDirectory() : false,
  ]);
  return cleanupResults.some(Boolean);
}

export async function preparePiperVoiceStorage(tts, voiceId, requiredBytes = 96 * 1024 * 1024) {
  await globalThis.navigator?.storage?.persist?.().catch(() => false);
  if (!await storageIsTight(requiredBytes)) return false;

  let cleared = await removeOtherSharedVoiceModels("");
  if (globalThis.caches) {
    cleared = await caches.delete(KOKORO_VOICE_CACHE).catch(() => false) || cleared;
  }

  if (typeof tts?.stored !== "function") return cleared;
  try {
    const storedVoices = await tts.stored();
    // Preserve the selected voice when it is already complete. Only stale
    // Piper voices should be evicted, otherwise every repeat generation would
    // redownload the same 30–64 MB model.
    for (const storedVoice of storedVoices) {
      if (storedVoice === voiceId || typeof tts.remove !== "function") continue;
      await tts.remove(storedVoice);
      cleared = true;
    }
    return cleared;
  } catch {
    return cleared;
  }
}

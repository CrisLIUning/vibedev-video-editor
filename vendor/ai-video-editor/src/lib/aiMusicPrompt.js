export const AI_MUSIC_PRESETS = {
  style: [
    ["cinematic", "cinematic soundtrack"],
    ["lofi", "lo-fi hip hop"],
    ["ambient", "ambient"],
    ["electronic", "electronic"],
    ["orchestral", "orchestral"],
  ],
  mood: [
    ["uplifting", "uplifting"],
    ["calm", "calm and peaceful"],
    ["dreamy", "dreamy"],
    ["dramatic", "dramatic"],
    ["dark", "dark and tense"],
  ],
  instrument: [
    ["piano", "piano"],
    ["guitar", "acoustic guitar"],
    ["synth", "analog synthesizer"],
    ["strings", "cinematic strings"],
    ["drums", "punchy drums"],
  ],
};

export function buildEnglishMusicPrompt(selection) {
  const lookup = (group, id) => AI_MUSIC_PRESETS[group].find(([key]) => key === id)?.[1];
  return [
    selection.descriptionEnglish?.trim(),
    lookup("style", selection.style),
    lookup("mood", selection.mood),
    lookup("instrument", selection.instrument),
    `${Math.max(60, Math.min(180, Number(selection.bpm) || 90))} BPM`,
    "instrumental music, clean production, no vocals",
  ].filter(Boolean).join(", ");
}

function containsOnlyEnglishPromptText(text) {
  return /^[\x00-\x7F]*$/.test(text);
}

const DEFAULT_TRANSLATION_TIMEOUT_MS = 12_000;

function normalizedLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (!language || language === "auto") return "";
  return language.split(/[-_]/, 1)[0];
}

export async function translateMusicDescriptionToEnglish(text, sourceLanguage = "en", options = {}) {
  const value = text.trim();
  if (!value || containsOnlyEnglishPromptText(value)) return value;

  const fallback = typeof options.fallback === "string" ? options.fallback : "";
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TRANSLATION_TIMEOUT_MS);
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw callerSignal.reason ?? new DOMException("Canceled", "AbortError");

  const controller = new AbortController();
  let rejectCallerAbort = null;
  const callerAbort = new Promise((_, reject) => { rejectCallerAbort = reject; });
  const abortFromCaller = () => {
    const reason = callerSignal.reason ?? new DOMException("Canceled", "AbortError");
    controller.abort(reason);
    rejectCallerAbort(reason);
  };
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let translator = null;
  let detector = null;
  let timeoutId = 0;
  const timeout = new Promise((resolve) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort(new DOMException("Music prompt translation timed out", "TimeoutError"));
      resolve(fallback);
    }, timeoutMs);
  });

  const translation = (async () => {
    let detectedLanguage = normalizedLanguage(sourceLanguage);
    // The editor already knows its selected UI language. Detect only when no
    // useful hint exists; LanguageDetector can otherwise trigger an unrelated
    // model download before music generation.
    if (!detectedLanguage && globalThis.LanguageDetector?.create) {
      try {
        detector = await globalThis.LanguageDetector.create({ signal: controller.signal });
        const results = await detector.detect(value, { signal: controller.signal });
        detectedLanguage = results?.[0]?.detectedLanguage || "";
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
    }
    if (!globalThis.Translator?.create) return fallback;
    translator = await globalThis.Translator.create({
      sourceLanguage: detectedLanguage || "zh",
      targetLanguage: "en",
      signal: controller.signal,
    });
    return translator.translate(value, { signal: controller.signal });
  })();

  try {
    return await Promise.race([translation, timeout, callerAbort]);
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason ?? error;
    return fallback;
  } finally {
    globalThis.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
    detector?.destroy?.();
    translator?.destroy?.();
  }
}

export function createAiMusicFileName(selection) {
  const style = selection.style || "music";
  return `AI ${style} ${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.wav`;
}

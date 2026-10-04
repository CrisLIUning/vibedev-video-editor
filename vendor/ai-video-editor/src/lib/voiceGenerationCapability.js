import { withHostIdentity } from "./hostAuthorizedMedia.js";
import { TtsInputError } from "./ttsText.js";
import { ESPEAK_PIPER_VOICES_ENABLED, KOKORO_VOICES_ENABLED } from "../config/vibedevFeatures.js";
function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `tts-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeFileStem(value) {
  return String(value || "voice").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 80) || "voice";
}

const VOICE_TITLE_MAX_CHARS = 24;

/** One line of spoken text, collapsed to something that fits on a card. */
export function voiceScriptExcerpt(script) {
  const line = String(script || "").replace(/\s+/g, " ").trim();
  if (!line) return "";
  return line.length > VOICE_TITLE_MAX_CHARS ? `${line.slice(0, VOICE_TITLE_MAX_CHARS)}…` : line;
}

/**
 * The voice a clip was actually spoken in. Cloning selects a profile while the
 * underlying engine voice stays the built-in one, so labelling the result with
 * `selectedVoice.name` named the wrong voice — a clone came back as "晴岚"
 * (field report 2026-09-03).
 */
export function effectiveVoiceName(voiceName, voiceProfileName) {
  return String(voiceProfileName || "").trim() || String(voiceName || "").trim() || "配音";
}

/**
 * What a generated voice clip is called in the media panel.
 *
 * It used to be the voice and a counter — "晴岚 · 1/1" — so every clip from one
 * voice looked identical and none of them said which line it was. The spoken
 * line is the only thing that tells them apart, so it leads; the voice follows,
 * for when the same line is generated in two voices. A clip with no text to
 * quote keeps the counter, which is still better than nothing.
 */
export function voiceClipTitle(script, voiceName, index, total) {
  const excerpt = voiceScriptExcerpt(script);
  if (!excerpt) return `${voiceName} · ${index + 1}/${total}`;
  return `${excerpt} · ${voiceName}`;
}

// FORK: a voice VibeDev's builds leave out (vibedevFeatures.js) has no host
// model to prepare, so the host never downloads one for it.
const HOST_VOICE_MODELS = Object.freeze({
  hojo: "hojo-tts-light-80m-zh",
  ...(KOKORO_VOICES_ENABLED ? { kokoro: "kokoro-82m-q8-en" } : {}),
});

const HOST_VOICE_MODELS_BY_VOICE = Object.freeze(ESPEAK_PIPER_VOICES_ENABLED ? {
  "de_DE-thorsten-medium": "piper-de-thorsten-medium",
  "es_ES-davefx-medium": "piper-es-davefx-medium",
  "fr_FR-siwis-medium": "piper-fr-siwis-medium",
  "it_IT-riccardo-x_low": "piper-it-riccardo-x-low",
  "pt_BR-faber-medium": "piper-pt-faber-medium",
} : {});

export async function startVoiceGenerationCapability({
  capabilityRuntime,
  voiceName,
  voiceProfileName,
  voiceId,
  voiceEngine,
  segmentCount,
}) {
  // FORK: refuse Kokoro before a host task starts; the editor shows the
  // TtsInputError's message (vibedevFeatures.js).
  if (voiceEngine === "kokoro" && !KOKORO_VOICES_ENABLED) throw new TtsInputError("ttsErrorEnglishVoiceUnavailable");
  const displayVoice = effectiveVoiceName(voiceName, voiceProfileName);
  if (!capabilityRuntime) {
    return {
      signal: undefined,
      modelArtifacts: undefined,
      progress: async () => {},
      complete: async (items) => items,
      fail: async () => {},
    };
  }
  const request = {
    schemaVersion: 1,
    requestId: createRequestId(),
    capability: "tts",
    title: `${displayVoice} · 配音`,
    outputKind: "audio",
    parameters: { voiceName: displayVoice, voiceId, voiceEngine, segmentCount },
  };
  const task = await capabilityRuntime.start(request);
  let settled = false;
  let modelArtifacts;
  const hostModelId = HOST_VOICE_MODELS_BY_VOICE[voiceId] || HOST_VOICE_MODELS[voiceEngine];
  if (hostModelId && capabilityRuntime.prepareModel) {
    try {
      const prepared = await capabilityRuntime.prepareModel({
        modelId: hostModelId,
        signal: task.signal,
        onProgress(update) {
          void capabilityRuntime.progress(task.taskId, update).catch(() => undefined);
        },
      });
      modelArtifacts = prepared.artifacts;
    } catch (error) {
      if (!task.signal.aborted) {
        await capabilityRuntime.fail(task.taskId, {
          code: "VIDEO_EDITOR_MODEL_PREPARE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
      throw error;
    }
  }
  return {
    signal: task.signal,
    modelArtifacts,
    async progress(update) {
      if (!settled && !task.signal.aborted) await capabilityRuntime.progress(task.taskId, update);
    },
    async complete(items) {
      if (task.signal.aborted) throw task.signal.reason || new DOMException("Canceled", "AbortError");
      const digits = Math.max(2, String(items.length).length);
      const completion = await capabilityRuntime.complete(task.taskId, request, {
        files: items.map((item, index) => ({
          blob: item.blob,
          // The spoken line names the file on disk too, so a project folder is
          // readable without opening the editor.
          fileName: `${safeFileStem(voiceScriptExcerpt(item.script) || displayVoice)}-${String(index + 1).padStart(digits, "0")}.wav`,
          mimeType: item.blob.type || "audio/wav",
          title: voiceClipTitle(item.script, displayVoice, index, items.length),
          ...(item.placement ? { placement: item.placement } : {}),
        })),
      });
      const assets = completion.assets || (completion.asset ? [completion.asset] : []);
      if (assets.length !== items.length) {
        throw new Error("TTS AssetVersion count does not match generated segment count.");
      }
      settled = true;
      // Every spelling of the host identity, so the merged asset list matches
      // this clip instead of adding the host's copy as a second card.
      return items.map((item, index) => withHostIdentity(item, assets[index]));
    },
    async fail(error) {
      if (settled || task.signal.aborted) return;
      settled = true;
      await capabilityRuntime.fail(task.taskId, {
        code: "VIDEO_EDITOR_TTS_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    },
  };
}

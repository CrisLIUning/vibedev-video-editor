import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from "./supertonicWebRuntime.js";
import { voiceModelFileUrls } from "../config/voiceModels.js";
import { orderModelUrlsForNetwork } from "./modelSources.js";
import { prepareVoiceModelStorage } from "./voiceModelStorage.js";

let runtimePromise;

async function loadRuntime(onProgress) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await prepareVoiceModelStorage({
        preserveModelPath: "supertonic",
        requiredBytes: 440 * 1024 * 1024,
        clearPiper: true,
      });
      const modelBases = await orderModelUrlsForNetwork(voiceModelFileUrls("supertonic/onnx"));
      const styleUrls = voiceModelFileUrls("supertonic/voice_styles/F1.json");
      const failures = [];
      for (const modelBase of modelBases) {
        const useModelScope = modelBase.includes("modelscope.cn");
        const styleUrl = styleUrls.find((url) => url.includes("modelscope.cn") === useModelScope) || styleUrls[0];
        try {
          const [{ textToSpeech }, style] = await Promise.all([
            loadTextToSpeech(modelBase, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }, (modelName, current, total) => {
              onProgress?.({ progress: (current / total) * 100, file: modelName });
            }),
            loadVoiceStyle([styleUrl], false),
          ]);
          return { textToSpeech, style };
        } catch (error) {
          failures.push(`${new URL(modelBase).hostname}: ${error?.message || String(error)}`);
        }
      }
      throw new Error(`MODEL_MIRRORS_UNAVAILABLE: ${failures.join("; ")}`);
    })().catch((error) => { runtimePromise = undefined; throw error; });
  }
  return runtimePromise;
}

export async function predictSupertonicVoice(input, onProgress) {
  const { textToSpeech, style } = await loadRuntime(onProgress);
  onProgress?.({ backend: "wasm", progress: 92 });
  await new Promise((resolve) => {
    if (globalThis.requestAnimationFrame) requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  const { wav, duration } = await textToSpeech.call(input.text.trim(), "ja", style, 5, Number(input.speed) || 1.05, 0.3, (step, total) => {
    onProgress?.({ progress: (step / total) * 100 });
  });
  const sampleCount = Math.max(1, Math.floor(textToSpeech.sampleRate * duration[0]));
  return new Blob([writeWavFile(wav.slice(0, sampleCount), textToSpeech.sampleRate)], { type: "audio/wav" });
}

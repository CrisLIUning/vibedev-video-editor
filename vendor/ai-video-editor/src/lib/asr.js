import { captionEvidence } from "./captionEvidence.js";
import {
  AUTOMATIC_CAPTION_MODEL_ID,
  AUTOMATIC_CAPTION_MODEL_LABEL,
  AUTOMATIC_CAPTION_MODEL_REVISION,
} from "../config/models.js";
import { makeId } from "./timeline.js";
import { createInterruptibleAsrWorkerClient } from "./asrWorkerClient.js";

const ASR_SAMPLE_RATE = 16000;
const CHINESE_VISIBLE_CHAR_THRESHOLD = 8;
const UI_LANGUAGE_TO_WHISPER_LANGUAGE = {
  zh: "zh",
  en: "en",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt",
  th: "th",
  vi: "vi",
};

const asrWorkerClient = createInterruptibleAsrWorkerClient({
  createWorker: () => typeof Worker === "undefined"
    ? null
    : new Worker(new URL("../workers/asr.worker.js", import.meta.url), { type: "module" }),
  createRequestId: () => makeId("asr"),
});

function getAudioContext(sampleRate = ASR_SAMPLE_RATE) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("当前浏览器不支持 AudioContext，无法识别音频。");
  }

  return new AudioContextClass({ sampleRate });
}

function downmixToMono(decoded) {
  const mono = new Float32Array(decoded.length);
  for (let channel=0;channel<decoded.numberOfChannels;channel++) {
    const values=decoded.getChannelData(channel);
    for(let i=0;i<mono.length;i++) mono[i]+=values[i]/decoded.numberOfChannels;
  }
  return mono;
}

async function decodeAudioForAsr(blob) {
  const audioContext = getAudioContext();
  try {
    const buffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    return {
      audio: downmixToMono(decoded),
      duration: decoded.duration,
      sampleRate: decoded.sampleRate, channels:decoded.numberOfChannels,
    };
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function transcribeAudioInWorker(audio, { onProgress, preferredLanguage, signal, modelArtifacts }) {
  return asrWorkerClient.transcribe(audio, {
    onProgress,
    preferredLanguage,
    signal,
    modelId: AUTOMATIC_CAPTION_MODEL_ID,
    modelArtifacts,
  });
}

function getTranscriptText(output) {
  const chunkText = Array.isArray(output?.chunks)
    ? output.chunks.map((chunk) => chunk?.text ?? "").join("")
    : "";
  return String(chunkText || output?.text || "").replace(/\s+/g, "");
}

function countPattern(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

function isSuspiciousChineseTranscript(output) {
  const text = getTranscriptText(output);
  const visibleCount = countPattern(text, /[^\s]/g);
  if (visibleCount < CHINESE_VISIBLE_CHAR_THRESHOLD) {
    return false;
  }

  const cjkCount = countPattern(text, /[\u3400-\u9fff]/g);
  const latinCount = countPattern(text, /[A-Za-zÀ-ÖØ-öø-ÿ]/g);
  const latinRatio = latinCount / visibleCount;
  const cjkRatio = cjkCount / visibleCount;
  const hasLongLatinRun = /[A-Za-zÀ-ÖØ-öø-ÿ]{12,}/.test(text);

  return cjkCount === 0 || (latinRatio > 0.45 && cjkRatio < 0.2) || hasLongLatinRun;
}

function isSuspiciousTranscript(output, language, preferredLanguage) {
  const expectedLanguage = language || UI_LANGUAGE_TO_WHISPER_LANGUAGE[preferredLanguage] || "zh";
  return expectedLanguage === "zh" && isSuspiciousChineseTranscript(output);
}

export async function transcribeAudioToCaptionSegments(
  blob,
  {
    onProgress,
    preferredLanguage = "zh",
    timelineOffset = 0,
    signal,
    requireInterruptible = false,
    modelArtifacts,
  } = {},
) {
  if (signal?.aborted) throw new DOMException("Automatic caption generation was canceled.", "AbortError");
  onProgress?.({ progress: 5, phase: "解码原声音频" });
  const { audio, duration, sampleRate, channels } = await decodeAudioForAsr(blob);
  if(sampleRate !== ASR_SAMPLE_RATE) throw new Error("CAPTION_SAMPLE_RATE_INVALID");
  if (signal?.aborted) throw new DOMException("Automatic caption generation was canceled.", "AbortError");
  if (!audio.length || !duration) {
    throw new Error("没有检测到可识别的音频。");
  }

  // Do not feed silence into Whisper: it can hallucinate plausible subtitles.
  // This is only a silence check, not a speech/music classifier or a quality verdict.
  let energy = 0;
  for (const sample of audio) energy += sample * sample;
  if (energy === 0) return {
    segments: [], text: "", duration, language: preferredLanguage, languageDetected: false,
    diagnostics: { sampleRate, channels, duration, rawOutput: { text: "", chunks: [] },
      recognitions: [], rejected: [], noSpeechReason: "digital-silence",
      timing: "no-speech", reviewRequired: true },
  };

  let result;
  try {
    result = await transcribeAudioInWorker(audio, { onProgress, preferredLanguage, signal, modelArtifacts });
    result.source = "worker";
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    // Browser/Worker failure must not silently bypass speech detection or cancellation.
    throw error;
  }
  // Language plausibility is evidence for review, not a reason to synthesize replacement text.
  const languageWarning=isSuspiciousTranscript(result.output,result.language,preferredLanguage);

  const evidence = captionEvidence(result.output,duration,Math.max(0,timelineOffset||0));
  const segments = evidence.segments;
  for(const segment of segments){
    const vad=result.vad; const start=Math.floor(segment.rawStart/(vad?.frameSeconds||.032)); const end=Math.ceil(segment.rawEnd/(vad?.frameSeconds||.032));
    const frames=vad?.probabilities?.slice(start,end)||[];const supported=frames.filter(p=>p>=.35).length;
    segment.warnings = [...(segment.warnings || []), ...(!frames.length || supported/frames.length<.3 || supported*(vad?.frameSeconds||.032)<.25 ? ['weak-speech-evidence'] : [])];
  }

  onProgress?.({ progress: 96, phase: "生成字幕草稿，等待校对" });
  return {
    segments,
    text: segments.map((segment) => segment.text).join("\n"),
    duration,
    language: result.language,
    languageDetected: result.languageDetected,
    diagnostics:{sampleRate,channels,duration,rawOutput:result.output,rejected:evidence.rejected,timingAdjustments:evidence.adjustments,vad:result.vad,recognitions:result.recognitions,timing:'whisper-segment-no-energy-realignment',reviewRequired:true,languageWarning},
  };
}

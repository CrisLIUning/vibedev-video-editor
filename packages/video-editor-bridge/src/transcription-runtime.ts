// Browser entry only: reuse the editor's pinned Whisper Worker and host artifact cache.
// @ts-expect-error Vendored browser implementation.
import { transcribeAudioToCaptionSegments } from '../../../vendor/ai-video-editor/src/lib/asr.js';
// @ts-expect-error Vendored browser implementation.
import { sliceAudioBlob } from '../../../vendor/ai-video-editor/src/lib/media.js';
import { base64Of, encodePcm16Wav, isDigitalSilence, planSpeechRegions } from './caption-regions.js';
import type { CaptionJobInput, SpeechRegion, TimelineSourceExtraction, TimelineSourceRecognition } from './caption-regions.js';

export type { CaptionJobInput, TimelineSourceExtraction, TimelineSourceRecognition } from './caption-regions.js';

/**
 * Recognize each source's stretch with the editor's Whisper pipeline (decode,
 * Silero VAD, Whisper small q8, evidence filtering), one source after another.
 * Segment times are seconds from `sourceIn`; progress is 0–100.
 */
export async function transcribeTimelineSources(
  input: CaptionJobInput,
  onProgress: (update: { progress: number; phase: string }) => void,
  signal: AbortSignal,
): Promise<TimelineSourceRecognition[]> {
  const result: TimelineSourceRecognition[] = [];
  for (const [index, source] of input.sources.entries()) {
    signal.throwIfAborted();
    const response = await fetch(source.url, { signal });
    if (!response.ok) throw new Error('CAPTION_SOURCE_UNAVAILABLE');
    const trimmed = await sliceAudioBlob(await response.blob(), source.sourceIn, source.sourceOut - source.sourceIn);
    signal.throwIfAborted();
    const output = await transcribeAudioToCaptionSegments(trimmed, {
      preferredLanguage: input.language,
      timelineOffset: 0,
      signal,
      requireInterruptible: true,
      modelArtifacts: input.artifacts,
      onProgress: (u: { progress: number; phase: string }) =>
        onProgress({ progress: Math.round(((index + u.progress / 100) / input.sources.length) * 100), phase: u.phase }),
    });
    signal.throwIfAborted();
    result.push({
      sourceClipId: source.clipId,
      diagnostics: output.diagnostics,
      segments: output.segments.map((s: { text: string; start: number; end: number; warnings?: string[] }) => ({
        text: s.text,
        start: s.start,
        end: s.end,
        ...(s.warnings ? { warnings: s.warnings } : {}),
      })),
    });
  }
  return result;
}

const ASR_SAMPLE_RATE = 16000;

/**
 * Decode a file at 16 kHz (the browser resamples while decoding), average its
 * channels and keep `[sourceIn, sourceOut)`. The whole file is decoded, as the
 * Whisper path does: browsers cannot decode part of a compressed file.
 */
async function decodeStretch16k(blob: Blob, sourceIn: number, sourceOut: number): Promise<Float32Array> {
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持 AudioContext，无法识别音频。');
  const context = new AudioContextClass({ sampleRate: ASR_SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    if (decoded.sampleRate !== ASR_SAMPLE_RATE) throw new Error('CAPTION_SAMPLE_RATE_INVALID');
    const first = Math.max(0, Math.min(decoded.length, Math.floor(sourceIn * ASR_SAMPLE_RATE)));
    const last = Math.max(first, Math.min(decoded.length, Math.floor(sourceOut * ASR_SAMPLE_RATE)));
    const mono = new Float32Array(last - first);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const values = decoded.getChannelData(channel).subarray(first, last);
      for (let index = 0; index < mono.length; index += 1) mono[index]! += values[index]! / decoded.numberOfChannels;
    }
    return mono;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * For a recognizer that answers text without timings: each source's stretch
 * decoded at 16 kHz mono, the speech regions the editor's Silero VAD finds in
 * it (the detector and region rules the Whisper worker uses, padded 0.25 s
 * before and 0.4 s after), merged across gaps under 0.3 s up to 15 s, split
 * over 30 s at the quietest frame, each with its audio as a base64 16-bit PCM
 * WAV. Region times are seconds of the source file; progress is 0–100.
 */
export async function extractTimelineAudio(
  input: CaptionJobInput,
  onProgress: (update: { progress: number; phase: string }) => void,
  signal: AbortSignal,
): Promise<TimelineSourceExtraction[]> {
  // Loaded on demand: the detector brings its own ONNX runtime, which only this job needs.
  // @ts-expect-error Vendored browser implementation.
  const { detectSpeech } = await import('../../../vendor/ai-video-editor/src/lib/speechVad.js') as {
    detectSpeech(audio: Float32Array, modelUrl: string | undefined): Promise<{ probabilities: number[]; regions: SpeechRegion[]; frameSeconds: number }>;
  };
  const report = (index: number, fraction: number, phase: string): void => {
    onProgress({ progress: Math.round(((index + fraction) / Math.max(1, input.sources.length)) * 100), phase });
  };
  const result: TimelineSourceExtraction[] = [];
  for (const [index, source] of input.sources.entries()) {
    signal.throwIfAborted();
    report(index, 0, '读取原声');
    const response = await fetch(source.url, { signal });
    if (!response.ok) throw new Error('CAPTION_SOURCE_UNAVAILABLE');
    const blob = await response.blob();
    signal.throwIfAborted();
    report(index, 0.1, '解码原声音频');
    const audio = await decodeStretch16k(blob, source.sourceIn, source.sourceOut);
    signal.throwIfAborted();
    if (isDigitalSilence(audio)) {
      result.push({ sourceClipId: source.clipId, regions: [] });
      continue;
    }
    report(index, 0.4, '检测人声');
    const vad = await detectSpeech(audio, input.artifacts['speech-vad']);
    signal.throwIfAborted();
    const regions = planSpeechRegions(vad.regions, vad.probabilities, vad.frameSeconds).map(region => {
      const samples = audio.subarray(Math.floor(region.start * ASR_SAMPLE_RATE), Math.ceil(region.end * ASR_SAMPLE_RATE));
      return { start: source.sourceIn + region.start, end: source.sourceIn + region.end, wav: base64Of(encodePcm16Wav(samples, ASR_SAMPLE_RATE)) };
    });
    result.push({ sourceClipId: source.clipId, regions });
    report(index, 1, '人声检测完成');
  }
  return result;
}

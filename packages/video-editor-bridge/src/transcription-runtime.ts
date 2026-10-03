// Browser entry only: reuse the editor's pinned Whisper Worker and host artifact cache.
// @ts-expect-error Vendored browser implementation.
import { transcribeAudioToCaptionSegments } from '../../../vendor/ai-video-editor/src/lib/asr.js';
// @ts-expect-error Vendored browser implementation.
import { sliceAudioBlob } from '../../../vendor/ai-video-editor/src/lib/media.js';
export async function transcribeTimelineSources(
  input: {
    sources: Array<{ url: string; sourceIn: number; sourceOut: number; clipId: string }>;
    artifacts: Record<string, string>;
    language: string;
  },
  onProgress: (update: { progress: number; phase: string }) => void,
  signal: AbortSignal,
) {
  const result: Array<{
    sourceClipId: string;
    segments: Array<{ text: string; start: number; end: number; warnings?: string[] }>;
    diagnostics?: Record<string, unknown>;
  }> = [];
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

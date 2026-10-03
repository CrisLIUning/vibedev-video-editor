export const DEFAULT_GENERATED_VOICE_GAP = 0.4;

export function getGeneratedVoiceAppendStart(audioSegments = [], fallbackStart = 0, gap = DEFAULT_GENERATED_VOICE_GAP) {
  if (!audioSegments.length) return Math.max(0, Number(fallbackStart) || 0);
  const trackEnd = audioSegments.reduce((end, segment) => Math.max(
    end,
    (Number(segment.start) || 0) + (Number(segment.duration) || 0),
  ), 0);
  return trackEnd + Math.max(0, Number(gap) || 0);
}

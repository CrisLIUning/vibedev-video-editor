/** Silero probabilities, not volume peaks. Padding preserves quiet endings and within-sentence pauses. */
export function speechRegions(probabilities, duration, frameSeconds = 512 / 16000) {
  const regions = []; let start = null; let lastVoice = 0;
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i]; const t = i * frameSeconds;
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('CAPTION_VAD_INVALID');
    if (p >= 0.5 && start === null) start = t;
    if (start !== null && p >= 0.35) lastVoice = Math.min(duration, t + frameSeconds);
    if (start !== null && (t - lastVoice >= 0.65 || i === probabilities.length - 1)) {
      if (lastVoice - start >= 0.096) {
        const region = {start: Math.max(0, start - 0.25), end: Math.min(duration, lastVoice + 0.4)};
        const previous = regions.at(-1);
        if (previous && region.start <= previous.end) previous.end = region.end;
        else regions.push(region);
      }
      start = null;
    }
  }
  return regions;
}

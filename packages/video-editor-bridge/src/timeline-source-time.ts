// @ts-expect-error Pinned vendor pure mapping; no browser dependencies.
import { getFinalSpeedCurveSourceTime } from '../../../vendor/ai-video-editor/src/lib/finalTimeRemap.js';
/** Match preview source time for constant speed and integrated speed curves. */
export function getTimelineSourceTime(clip: Record<string, unknown>, localSeconds: number): number {
  if (clip.speedCurve && (clip.speedCurve as Record<string, unknown>).enabled !== false)
    return getFinalSpeedCurveSourceTime(clip, localSeconds) as number;
  const start = Math.max(0, Number(clip.sourceStart) || 0);
  const span = Number(clip.sourceDuration);
  const advance =
    Math.max(0, Math.min(Number(clip.duration) || 0, localSeconds)) *
    Math.max(0.25, Math.min(4, Number(clip.playbackRate) || 1));
  return start + (Number.isFinite(span) && span > 0 ? Math.min(span, advance) : advance);
}
/** Invert the SAME monotone preview mapping to sub-nanosecond precision; no sampled approximation. */
export function getTimelineLocalTime(clip: Record<string, unknown>, sourceSeconds: number): number {
  if (!clip.speedCurve || (clip.speedCurve as Record<string, unknown>).enabled === false)
    return Math.max(
      0,
      Math.min(
        Number(clip.duration) || 0,
        (sourceSeconds - (Number(clip.sourceStart) || 0)) / Math.max(0.25, Math.min(4, Number(clip.playbackRate) || 1)),
      ),
    );
  let low = 0,
    high = Math.max(0, Number(clip.duration) || 0);
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (getTimelineSourceTime(clip, middle) < sourceSeconds) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

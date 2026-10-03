import { getFinalSpeedCurveSourceProgress } from "./finalTimeRemap.js";
const MIN_MAPPING_SECONDS = 0.001;
export const MIN_VISUAL_PLAYBACK_RATE = 0.25;
export const MAX_VISUAL_PLAYBACK_RATE = 4;

export function normalizeVisualPlaybackRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 1;
  return Math.max(MIN_VISUAL_PLAYBACK_RATE, Math.min(MAX_VISUAL_PLAYBACK_RATE, rate));
}

function getVibedevTimeRemapState(segment, localTime = 0) {
  const runtime = segment?.vibedevTimeRemapRuntime;
  const steps = Array.isArray(runtime?.segments) ? runtime.segments : [];
  if (!steps.length) return null;
  const duration = Math.max(0, Number(runtime.duration) || steps.reduce(
    (total, step) => total + Math.max(0, Number(step?.durationSeconds) || 0),
    0,
  ));
  const target = Math.max(0, Math.min(duration, Number(localTime) || 0));
  let cursor = 0;
  for (const step of steps) {
    const stepDuration = Math.max(0, Number(step?.durationSeconds) || 0);
    const end = cursor + stepDuration;
    if (target <= end + 1e-7) {
      if (step?.kind === "freeze") {
        return {
          sourceTime: Math.max(0, Number(step.sourceSeconds) || 0),
          playbackRate: normalizeVisualPlaybackRate(segment?.playbackRate),
        };
      }
      const progress = stepDuration > 0
        ? Math.max(0, Math.min(1, (target - cursor) / stepDuration))
        : 0;
      const sourceIn = Math.max(0, Number(step?.sourceInSeconds) || 0);
      const sourceOut = Math.max(0, Number(step?.sourceOutSeconds) || sourceIn);
      return {
        sourceTime: sourceIn + (sourceOut - sourceIn) * progress,
        playbackRate: normalizeVisualPlaybackRate(step?.rate),
      };
    }
    cursor = end;
  }
  return null;
}

export function requiresTimelineDrivenVideoFrames(segment) {
  const steps = segment?.vibedevTimeRemapRuntime?.segments;
  return Array.isArray(steps) && steps.some((step) => step?.kind === "freeze" || step?.reverse === true);
}

export function shouldUseNativeVisualPlayback(segment, isPlaying, visible = true) {
  return Boolean(isPlaying && visible && !requiresTimelineDrivenVideoFrames(segment));
}

export function getVisualSourceTime(segment, localTime = 0) {
  const remapped = getVibedevTimeRemapState(segment, localTime);
  if (remapped) return remapped.sourceTime;
  const start = Math.max(0, Number(segment?.sourceStart) || 0);
  const duration = Math.max(MIN_MAPPING_SECONDS, Number(segment?.duration) || MIN_MAPPING_SECONDS);
  const sourceDuration = Math.max(MIN_MAPPING_SECONDS, Number(segment?.sourceDuration) || duration * normalizeVisualPlaybackRate(segment?.playbackRate));
  if (segment?.speedCurve?.enabled && Array.isArray(segment.speedCurve.points)) {
    const progress = Math.max(0, Math.min(1, Math.max(0, Number(localTime) || 0) / duration));
    // Preview, export, trimming and thumbnails share this normalized integral.
    return start + sourceDuration * getFinalSpeedCurveSourceProgress(segment.speedCurve, progress);
  }
  return start + Math.max(0, Number(localTime) || 0) * normalizeVisualPlaybackRate(segment?.playbackRate);
}

export function getVisualPlaybackRateAtTime(segment, localTime = 0) {
  const remapped = getVibedevTimeRemapState(segment, localTime);
  if (remapped) return remapped.playbackRate;
  if (!segment?.speedCurve?.enabled || !Array.isArray(segment.speedCurve.points)) return normalizeVisualPlaybackRate(segment?.playbackRate);
  const duration = Math.max(MIN_MAPPING_SECONDS, Number(segment.duration) || MIN_MAPPING_SECONDS);
  const from = Math.max(0, Math.min(duration - 0.0001, localTime));
  const to = Math.min(duration, from + 0.0001);
  return normalizeVisualPlaybackRate((getVisualSourceTime(segment, to) - getVisualSourceTime(segment, from)) / (to - from));
}

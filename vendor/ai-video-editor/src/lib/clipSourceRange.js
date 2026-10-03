import { getVisualSourceTime, normalizeVisualPlaybackRate } from "./clipTimeMapping.js";

/** Cut in timeline seconds without changing the speed or regenerating a curve. */
export function sliceClipSource(segment, from, to) {
  const duration = Math.max(0.001, Number(segment.duration) || 0.001);
  const start = Math.max(0, Math.min(duration, from));
  const end = Math.max(start, Math.min(duration, to));
  const result = { ...segment, duration: end - start };
  if (Array.isArray(segment.keyframes)) result.keyframes = segment.keyframes
    .filter(frame => frame.time >= start && frame.time <= end)
    .map(frame => ({ ...frame, time: frame.time - start }));
  if (segment.type === "image") return result;
  result.sourceStart = getVisualSourceTime(segment, start);
  result.sourceDuration = Math.abs(getVisualSourceTime(segment, end) - result.sourceStart);
  result.sourceMediaDuration = segment.sourceMediaDuration || segment.trackFrameDuration
    || (Number(segment.sourceStart) || 0) + (Number(segment.sourceDuration) || duration * normalizeVisualPlaybackRate(segment.playbackRate));
  if (segment.speedCurve?.enabled) {
    const old = segment.speedCurve.window || { start: 0, end: 1 };
    result.speedCurve = { ...segment.speedCurve, window: {
      start: old.start + (old.end - old.start) * start / duration,
      end: old.start + (old.end - old.start) * end / duration,
    } };
  }
  if (segment.vibedevTimeRemapRuntime?.segments?.length) {
    let cursor = 0;
    const steps = segment.vibedevTimeRemapRuntime.segments.flatMap(step => {
      const at = cursor; cursor += step.durationSeconds;
      const left = Math.max(start, at), right = Math.min(end, cursor);
      if (right <= left) return [];
      if (step.kind === "freeze") return [{ ...step, durationSeconds: right - left }];
      const span = step.sourceOutSeconds - step.sourceInSeconds;
      return [{ ...step, durationSeconds: right - left,
        sourceInSeconds: step.sourceInSeconds + span * (left - at) / step.durationSeconds,
        sourceOutSeconds: step.sourceInSeconds + span * (right - at) / step.durationSeconds }];
    });
    result.vibedevTimeRemapRuntime = { ...segment.vibedevTimeRemapRuntime, duration: end - start, segments: steps };
  }
  return result;
}

/** Bounds in clip-local timeline seconds; negative times restore a leading cut.
 * Curves/reverse/freeze can be cut exactly but cannot be extrapolated. */
export function getClipTrimBounds(segment) {
  if (segment.speedCurve?.enabled || segment.vibedevTimeRemapRuntime?.segments?.length) return { from: 0, to: segment.duration };
  const rate = normalizeVisualPlaybackRate(segment.playbackRate);
  const start = Math.max(0, Number(segment.sourceStart) || 0);
  const mediaEnd = segment.sourceMediaDuration || segment.trackFrameDuration || start + (segment.sourceDuration || segment.duration * rate);
  return { from: -start / rate, to: (mediaEnd - start) / rate };
}

/** Trim or restore the source window, never derive a new playback speed.
 * Main-track clips stay contiguous; timed overlays decide their own start. */
export function trimClipRange(segment, requestedFrom, requestedTo) {
  const media = segment.type === "video" || segment.type === "audio";
  const bounds = media ? getClipTrimBounds(segment) : { from: -Infinity, to: Infinity };
  const from = Math.max(bounds.from, Math.min(bounds.to - 0.001, requestedTo - 0.001, requestedFrom));
  const to = Math.min(bounds.to, Math.max(from + 0.001, requestedTo));
  if (from === 0 && to === segment.duration) return segment;
  if (from >= 0 && to <= segment.duration) return sliceClipSource(segment, from, to);
  const result = { ...segment, duration: to - from };
  if (Array.isArray(segment.keyframes)) result.keyframes = segment.keyframes
    .filter(frame => frame.time >= from && frame.time <= to)
    .map(frame => ({ ...frame, time: frame.time - from }));
  if (!media) return result;
  const rate = normalizeVisualPlaybackRate(segment.playbackRate);
  const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
  return { ...result, sourceStart: sourceStart + from * rate, sourceDuration: result.duration * rate,
    sourceMediaDuration: sourceStart + bounds.to * rate };
}

export function trimClipDuration(segment, requestedDuration) {
  return trimClipRange(segment, 0, Math.max(0.1, Number(requestedDuration) || 0.1));
}

export function sourceTimeToClipTime(segment, sourceTime) {
  if (segment.vibedevTimeRemapRuntime?.segments?.some(step => step.reverse || step.kind === "freeze")) {
    throw Object.assign(new Error("Source trim is ambiguous for reverse/freeze; split by timeline time instead"), { code: "INVALID_RANGE" });
  }
  if (!segment.speedCurve?.enabled && !segment.vibedevTimeRemapRuntime?.segments?.length) return (sourceTime - (segment.sourceStart || 0)) / normalizeVisualPlaybackRate(segment.playbackRate);
  let low = 0, high = segment.duration;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (getVisualSourceTime(segment, mid) < sourceTime) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

/** Move an overlay's left edge while keeping its timeline end and source speed. */
export function trimClipStart(segment, requestedStart) {
  const oldStart = Number(segment.start) || 0;
  const end = oldStart + segment.duration;
  const start = Math.max(0, Math.min(end - 0.1, requestedStart));
  const trimmed = trimClipRange(segment, start - oldStart, segment.duration);
  return { ...trimmed, start: end - trimmed.duration };
}

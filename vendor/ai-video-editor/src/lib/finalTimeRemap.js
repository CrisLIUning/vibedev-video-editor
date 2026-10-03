const MIN_RATE = 0.25;
const MAX_RATE = 4;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function normalizePoints(value) {
  const points = (Array.isArray(value?.points) ? value.points : [])
    .filter((point) => point && Number.isFinite(Number(point.progress)) && Number.isFinite(Number(point.rate)))
    .map((point) => ({
      progress: clamp(Number(point.progress), 0, 1),
      rate: clamp(Number(point.rate), MIN_RATE, MAX_RATE),
    }))
    .sort((left, right) => left.progress - right.progress);
  if (points.length < 2) return [{ progress: 0, rate: 1 }, { progress: 1, rate: 1 }];
  points[0] = { ...points[0], progress: 0 };
  points[points.length - 1] = { ...points.at(-1), progress: 1 };
  return points;
}

/** Pure final-render copy of the fork preview's integrated speed-curve
 * mapping. It intentionally has no React/editor imports so the Daemon bridge
 * cannot pull UI dependencies into its server-side contract bundle. */
function baseSourceProgress(value, progress) {
  const points = normalizePoints(value);
  const target = clamp(Number(progress) || 0, 0, 1);
  const smooth = value?.smooth !== false;
  const segmentIntegral = (left, right, local = 1) => {
    const time = clamp(local, 0, 1);
    const easingIntegral = smooth ? time ** 3 - 0.5 * time ** 4 : 0.5 * time ** 2;
    return (right.progress - left.progress)
      * (left.rate * time + (right.rate - left.rate) * easingIntegral);
  };
  const total = points.slice(0, -1)
    .reduce((sum, point, index) => sum + segmentIntegral(point, points[index + 1]), 0) || 1;
  let consumed = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (target >= right.progress) consumed += segmentIntegral(left, right);
    else if (target > left.progress) {
      consumed += segmentIntegral(
        left,
        right,
        (target - left.progress) / Math.max(0.0001, right.progress - left.progress),
      );
      break;
    } else break;
  }
  return clamp(consumed / total, 0, 1);
}

export function getFinalSpeedCurveSourceTime(segment, localTime) {
  const duration = Math.max(0.001, Number(segment?.duration) || 0.001);
  const sourceStart = Math.max(0, Number(segment?.sourceStart) || 0);
  const sourceDuration = Math.max(0.001, Number(segment?.sourceDuration) || duration);
  const progress = clamp((Number(localTime) || 0) / duration, 0, 1);
  return sourceStart
    + sourceDuration * getFinalSpeedCurveSourceProgress(segment?.speedCurve, progress);
}

export function getFinalSpeedCurveSourceProgress(value, progress) {
  const start = clamp(Number(value?.window?.start) || 0, 0, 1);
  const end = clamp(Number(value?.window?.end ?? 1), start, 1);
  const from = baseSourceProgress(value, start);
  const to = baseSourceProgress(value, end);
  return (baseSourceProgress(value, start + (end - start) * clamp(Number(progress) || 0, 0, 1)) - from) / Math.max(1e-12, to - from);
}

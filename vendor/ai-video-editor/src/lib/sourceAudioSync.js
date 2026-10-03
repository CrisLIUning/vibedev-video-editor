import { getLinkedSourceAudioSegments, getVisualAudioSource } from "./sourceAudioMapping.js";
export { getLinkedSourceAudioSegments } from "./sourceAudioMapping.js";
import { getVisualSegmentTimeline } from "./timeline.js";
import { getVisualPlaybackRateAtTime, getVisualSourceTime, normalizeVisualPlaybackRate } from "./visualEffects.js";


export function getSourceAudioAssetId(source = {}) {
  return source.assetId || source.id || "";
}

export function attachSourceAudioOffset(visualSegments = [], source = {}, sourceAudioOffset = 0) {
  const assetId = getSourceAudioAssetId(source);
  const clipId = source.id || "";
  const offset = Math.max(0, Number(sourceAudioOffset) || 0);
  if (!assetId && !clipId) return visualSegments;
  const hasExactClipTarget = Boolean(clipId && visualSegments.some((segment) => (
    segment.type === "video" && segment.id === clipId
  )));
  return visualSegments.map((segment) => {
    if (segment.type !== "video") return segment;
    const matchesExactClip = hasExactClipTarget && segment.id === clipId;
    const matchesAssetFallback = !hasExactClipTarget && Boolean(assetId && segment.assetId === assetId);
    const matchesUnboundClip = !hasExactClipTarget && Boolean(clipId && !segment.assetId && segment.id === clipId);
    return matchesExactClip || matchesAssetFallback || matchesUnboundClip
      ? { ...segment, sourceAudioOffset: offset }
      : segment;
  });
}


export function moveLinkedSourceAudioSegment(visualSegments = [], segmentId = "", timelineStart = 0) {
  const index = visualSegments.findIndex((segment) => segment.type === "video" && segment.id === segmentId);
  if (index < 0) return visualSegments;
  const range = getVisualSegmentTimeline(visualSegments)[index];
  if (!range) return visualSegments;
  const offset = Math.max(0, Number(timelineStart) || 0) - range.start;
  return visualSegments.map((segment, position) => (
    position === index ? { ...segment, sourceAudioTimelineOffset: offset } : segment
  ));
}

export function getLinkedSourceAudioState(linkedSegments = [], timelineTime = 0) {
  const time = Math.max(0, Number(timelineTime) || 0);
  const segment = linkedSegments.find((item) => time >= item.start && time < item.start + item.duration);
  if (!segment) return { active: false, sourceTime: 0, playbackRate: 1, segment: null };
  const localTime = Math.max(0, time - segment.start);
  return {
    active: true,
    sourceTime: getVisualSourceTime(segment, localTime),
    playbackRate: getVisualPlaybackRateAtTime(segment, localTime),
    segment,
  };
}

export function getLinkedSourceAudioEnd(linkedSegments = []) {
  return linkedSegments.reduce((end, segment) => Math.max(end, segment.start + segment.duration), 0);
}

export function shouldMuteEmbeddedVideoAudio(segment, { sourceAudioBlob = null, sourceAudioAssetId = "", linkedSegments = [], visualSegments = [] } = {}) {
  return getVisualAudioSource(segment, { hasSourceAudio: Boolean(sourceAudioBlob), sourceAudioAssetId, visualSegments }) !== "embedded"
    || Boolean(sourceAudioBlob && linkedSegments.some(item => item.id === segment?.id));
}

export function sliceSourceAudioPeaks(peaks = [], segment, sourceAudioDuration = 0) {
  if (!peaks.length || !segment || sourceAudioDuration <= 0) return peaks;
  const startIndex = Math.max(0, Math.floor((segment.sourceStart / sourceAudioDuration) * peaks.length));
  const endIndex = Math.min(
    peaks.length,
    Math.max(startIndex + 1, Math.ceil(((segment.sourceStart + segment.sourceDuration) / sourceAudioDuration) * peaks.length)),
  );
  return peaks.slice(startIndex, endIndex);
}

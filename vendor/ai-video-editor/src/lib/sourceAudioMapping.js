/** Pure source-lane mapping shared by preview, recognition and native export. */
function resolveLinkedAssetId(visualSegments, sourceAudioAssetId) {
  if (sourceAudioAssetId) return sourceAudioAssetId;
  const assetIds = Array.from(new Set(
    visualSegments
      .filter((segment) => segment.type === "video" && segment.assetId)
      .map((segment) => segment.assetId),
  ));
  return assetIds.length === 1 ? assetIds[0] : "";
}

/** Resolve the audible source per clip, including partially extracted projects. */
export function getVisualAudioSource(segment, { hasSourceAudio = false, sourceAudioAssetId = "", visualSegments = [] } = {}) {
  if (!segment || segment.type !== "video" || segment.sourceAudioDisabled || segment.muted === true) return "silent";
  if (!hasSourceAudio) return "embedded";
  const explicit = visualSegments.some(item => item.type === "video" && Number.isFinite(item.sourceAudioOffset));
  const mapped = Number.isFinite(segment.sourceAudioOffset) || (!explicit && segment.assetId && segment.assetId === resolveLinkedAssetId(visualSegments, sourceAudioAssetId));
  return mapped ? "source" : "embedded";
}

export function getLinkedSourceAudioSegments(visualSegments = [], sourceAudioAssetId = "", sourceAudioDuration = 0) {
  const hasMappedOffsets = visualSegments.some((segment) => segment.type === "video" && Number.isFinite(segment.sourceAudioOffset));
  const linkedAssetId = resolveLinkedAssetId(visualSegments, sourceAudioAssetId);
  if (!hasMappedOffsets && !linkedAssetId) return [];
  let cursor = 0;
  const timeline = visualSegments.map(segment => { const duration = Math.max(0, segment.duration || 0); const start = cursor; cursor += duration; return { start, duration }; });
  const maximumSourceTime = Math.max(0, Number(sourceAudioDuration) || 0);
  return visualSegments.flatMap((segment, index) => {
    const hasSegmentMapping = Number.isFinite(segment.sourceAudioOffset);
    const matchesLegacyAssetMapping = !hasMappedOffsets && segment.assetId === linkedAssetId;
    if (segment.type !== "video" || segment.sourceAudioDisabled || segment.muted === true || (!hasSegmentMapping && !matchesLegacyAssetMapping)) return [];
    const range = timeline[index];
    const playbackRate = Math.max(.25, Math.min(4, Number.isFinite(Number(segment.playbackRate)) ? Number(segment.playbackRate) : 1));
    const sourceStart = Math.max(0, Number(segment.sourceAudioOffset) || 0) + Math.max(0, Number(segment.sourceStart) || 0);
    const requestedSourceDuration = Math.max(0, Number(segment.sourceDuration) || segment.duration * playbackRate);
    const curved = segment.speedCurve && segment.speedCurve.enabled !== false;
    const availableSourceDuration = maximumSourceTime
      ? Math.max(0, Math.min(requestedSourceDuration, maximumSourceTime - sourceStart))
      : requestedSourceDuration;
    const sourceDuration = curved ? requestedSourceDuration : availableSourceDuration;
    if (!range || availableSourceDuration <= 0) return [];
    const timelineOffset = Number.isFinite(Number(segment.sourceAudioTimelineOffset))
      ? Number(segment.sourceAudioTimelineOffset)
      : 0;
    return [{
      id: segment.id,
      assetId: segment.assetId || linkedAssetId,
      start: Math.max(0, range.start + timelineOffset),
      duration: curved ? range.duration : Math.min(range.duration, sourceDuration / playbackRate),
      ...(curved && availableSourceDuration < requestedSourceDuration ? { availableSourceDuration } : {}),
      sourceStart,
      sourceDuration,
      playbackRate,
      speedCurve: segment.speedCurve,
    }];
  });
}

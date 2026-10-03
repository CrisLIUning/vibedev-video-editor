import { concatenateAudioBlobs, decodeWaveform, extractAudioFromVideo } from "./media.js";
import { isExportAbortError, throwIfExportAborted } from "./exportCancellation.js";
// FORK: a file with no sound in it is not a file whose sound we lost.
import { isSilentSourceError } from "./sourceAudioAvailability.js";
import { getVisualSegmentTimeline } from "./timeline.js";

const getAssetKey = (segment) => segment?.assetVersionId || segment?.src || segment?.assetId || segment?.id || "";

/**
 * FORK: every clip cut from a file whose sound did not come — not only the
 * one clip the extraction happened to be keyed by.
 *
 * One take gives one key and one extraction however many shots were cut from
 * it, so naming the clip that carried the attempt names the last of them and
 * hides the rest. The film-demo cut is two shots of one take: the extraction
 * is reported against 第 2 镜 and 第 1 镜 loses its sound just as silently.
 *
 * Each entry carries where it plays, because the caller judges an export
 * range and a clip outside it costs that render nothing.
 */
function lostSourceAudioClips(visualSegments, candidates, keys) {
  if (!keys.size) return [];
  const timeline = getVisualSegmentTimeline(visualSegments);
  const startById = new Map(visualSegments.map((segment, index) => [segment.id, timeline[index]?.start || 0]));
  return candidates
    .filter((segment) => keys.has(getAssetKey(segment)))
    .map((segment) => ({
      id: segment.id,
      name: segment.name || "",
      start: startById.get(segment.id) || 0,
      duration: Math.max(0, Number(segment.duration) || 0),
    }));
}

export function createEmbeddedVideoAudioSegments(visualSegments = [], audioAssets = new Map()) {
  const timeline = getVisualSegmentTimeline(visualSegments);
  return visualSegments.flatMap((segment, index) => {
    if (segment.type !== "video" || segment.sourceAudioDisabled || segment.muted === true) return [];
    const audio = audioAssets.get(getAssetKey(segment));
    if (!audio) return [];
    const playbackRate = Math.max(0.25, Math.min(4, Number(segment.playbackRate) || 1));
    const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
    const requestedSourceDuration = Math.max(0, Number(segment.sourceDuration) || segment.duration * playbackRate);
    const availableSourceDuration = Math.max(0, audio.duration - sourceStart);
    const sourceDuration = Math.min(requestedSourceDuration || availableSourceDuration, availableSourceDuration);
    if (!(sourceDuration > 0)) return [];
    return [{
      id: segment.id,
      assetId: segment.assetId,
      start: timeline[index]?.start || 0,
      duration: Math.min(segment.duration, sourceDuration / playbackRate),
      sourceStart: audio.offset + sourceStart,
      sourceDuration,
      playbackRate,
      volume: segment.volume ?? 1,
      speedCurve: segment.speedCurve,
      vibedevTimeRemapRuntime: segment.vibedevTimeRemapRuntime,
    }];
  });
}

export async function prepareEmbeddedVideoAudio(visualSegments = [], onProgress, signal) {
  throwIfExportAborted(signal);
  const candidates = visualSegments.filter((segment) => segment.type === "video" && !segment.sourceAudioDisabled && segment.muted !== true);
  const uniqueAssets = [...new Map(candidates.map((segment) => [getAssetKey(segment), segment])).entries()];
  if (!uniqueAssets.length) return { blob: null, segments: [], lost: [] };

  const extracted = [];
  // FORK: the takes whose sound the export was supposed to mix and could not
  // get. A take with no audio stream never joins this set: there is nothing
  // to lose and nothing to say, which is the same answer the headless lane
  // gives by leaving it out of `media.sourceAudio`.
  const lostKeys = new Set();
  for (let index = 0; index < uniqueAssets.length; index += 1) {
    throwIfExportAborted(signal);
    const [key, segment] = uniqueAssets[index];
    onProgress?.({
      progress: 2 + Math.round((index / uniqueAssets.length) * 3),
      phaseKey: "exportEmbeddedAudio",
      phaseParams: { current: index + 1, total: uniqueAssets.length },
    });
    try {
      const sourceBlob = segment.blob instanceof Blob
        ? segment.blob
        : segment.src
          ? await fetch(segment.src, { signal }).then((response) => {
              if (!response.ok) throw new Error(`无法读取视频素材：${response.status}`);
              return response.blob();
            })
          : null;
      // FORK: no file to read is a sound we could not get, not a silent one.
      if (!sourceBlob) { lostKeys.add(key); continue; }
      const blob = segment.compatibilityAudioBlob instanceof Blob
        ? segment.compatibilityAudioBlob
        : await extractAudioFromVideo(sourceBlob, segment.name || "source-video.mp4");
      throwIfExportAborted(signal);
      const decoded = await decodeWaveform(blob, 24);
      throwIfExportAborted(signal);
      // A track that decodes to nothing is a silent take by another route.
      if (decoded.duration > 0) extracted.push({ key, blob, duration: decoded.duration });
    } catch (error) {
      if (isExportAbortError(error)) throw error;
      // FORK: the caller is told about this one; the log is for us.
      if (!isSilentSourceError(error)) lostKeys.add(key);
      console.warn("Embedded video audio extraction skipped", segment.name || segment.id, error);
    }
  }
  const lost = lostSourceAudioClips(visualSegments, candidates, lostKeys);
  if (!extracted.length) return { blob: null, segments: [], lost };

  let offset = 0;
  const audioAssets = new Map(extracted.map((item) => {
    const mapped = [item.key, { offset, duration: item.duration }];
    offset += item.duration;
    return mapped;
  }));
  throwIfExportAborted(signal);
  const blob = await concatenateAudioBlobs(extracted.map((item) => item.blob));
  throwIfExportAborted(signal);
  return {
    blob,
    segments: createEmbeddedVideoAudioSegments(visualSegments, audioAssets),
    lost,
  };
}

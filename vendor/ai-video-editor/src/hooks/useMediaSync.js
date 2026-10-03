import { useCallback, useEffect, useRef, useState } from "react";
import { PLAYBACK_UI_FRAME_MS, getAudioSegmentPreviewVolume, getTimelineTrackLocalTime, isTimelineTimeInsideTrack, requestTimelineMediaPlay, setTimelineAudioGain, shouldCorrectPreviewMediaTime } from "../lib/editorRuntime.js";
import { getLinkedSourceAudioState } from "../lib/sourceAudioSync.js";
import { isTimedSegmentLaneVisible } from "../lib/timeline.js";
import { cancelLatestVideoFrameRequest, requestLatestVideoFrame } from "../lib/videoFrameSync.js";
import {
  getVisualPlaybackRateAtTime,
  getVisualSourceTime,
  requiresTimelineDrivenVideoFrames,
  shouldSeekPreviewVideoOnSegmentChange,
  shouldUseNativeVisualPlayback,
} from "../lib/visualEffects.js";

const audioPlaybackSegments = new WeakMap();

export function previewPlaybackRate(media, expectedTime, baseRate) {
  if (!media || media.paused || media.seeking || media.readyState < 3) return baseRate;
  const drift = expectedTime - media.currentTime;
  if (Math.abs(drift) < 0.04) return baseRate;
  return Math.max(0.25, Math.min(4, baseRate + Math.max(-0.25, Math.min(0.25, drift * 2))));
}

export function syncTimelineAudioElement(media, { active, shouldPlay, expectedTime, playbackRate = 1, segmentKey }) {
  if (!media) return;
  media.playbackRate = playbackRate;
  if ("preservesPitch" in media) media.preservesPitch = true;
  if (!shouldPlay || !active) {
    audioPlaybackSegments.delete(media);
    if (!media.paused) media.pause();
    return;
  }
  // A continuous DOM element can cross a discontinuous source cut. Seek on
  // clip changes, but do not chase the React clock inside an unchanged clip.
  const changed = segmentKey !== undefined && audioPlaybackSegments.get(media) !== segmentKey;
  audioPlaybackSegments.set(media, segmentKey);
  if (changed && Math.abs(media.currentTime - expectedTime) > 0.04) media.currentTime = expectedTime;
  if (media.paused && !media.__timelinePlayPending) {
    if (Math.abs(media.currentTime - expectedTime) > 0.04) media.currentTime = expectedTime;
    requestTimelineMediaPlay(media);
  }
}

export function syncVoiceAudioSegments({ segments, refs, timelineTime, isPlaying, visibility }) {
  segments.forEach((segment) => {
    const audio = refs.current.get(segment.id);
    if (!audio) return;
    if (!isPlaying || !isTimedSegmentLaneVisible(segments, segment.id, visibility)) {
      if (!audio.paused) audio.pause();
      return;
    }
    const active = isTimelineTimeInsideTrack(timelineTime, segment.start, segment.duration);
    const playbackRate = Math.max(0.25, Math.min(4, Number(segment.playbackRate) || 1));
    const expected = Math.max(0, Number(segment.sourceStart) || 0) + getTimelineTrackLocalTime(timelineTime, segment.start, segment.duration) * playbackRate;
    syncTimelineAudioElement(audio, { active, shouldPlay: true, expectedTime: expected, playbackRate, segmentKey: `${segment.id}:${segment.sourceStart || 0}:${segment.start}` });
  });
}

export function useMediaSync(d) {
  const previousPreviewVisualSegmentRef = useRef(null);
  const latest = useRef(d); latest.current = d;
  const [previewVideoNode, setPreviewVideoNode] = useState(null);
  const boundVideo = useRef(null);
  const attachPreviewVideo = useCallback((node) => {
    if (boundVideo.current !== node) cancelLatestVideoFrameRequest(boundVideo.current);
    boundVideo.current = node;
    latest.current.previewVideoRef.current = node;
    setPreviewVideoNode(node);
  }, []);
  // Portalling the stage creates a fresh video even when src and isPlaying
  // stay the same. Bind to the element, then align it to the live timeline.
  useEffect(() => {
    const video = previewVideoNode;
    if (!video) return;
    const sync = () => {
      // Only a freshly bound, still paused element is aligned here. Once its
      // native clock runs, `canplay` also follows every seek and buffering
      // recovery; chasing the throttled React clock from there re-seeks on
      // each recovery and stutters the video (visible after a scrub-then-play
      // on machines where a seek takes longer than the 40ms tolerance).
      if (!video.paused) return;
      const state = latest.current;
      const time = Math.max(0, Number(state.previewVisualSourceTime) || 0);
      if (Math.abs(video.currentTime - time) > 0.04) video.currentTime = time;
      video.playbackRate = getVisualPlaybackRateAtTime(state.previewVisualSegment, Math.max(0, state.currentTime - (state.previewVisualRange?.start || 0)));
      if (shouldUseNativeVisualPlayback(state.previewVisualSegment, state.isPlaying, state.trackVisibility?.image !== false)) requestTimelineMediaPlay(video);
      else video.pause();
    };
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("canplay", sync);
    if (video.readyState >= 1) sync();
    return () => {
      video.removeEventListener("loadedmetadata", sync); video.removeEventListener("canplay", sync);
      cancelLatestVideoFrameRequest(video);
    };
  }, [previewVideoNode]);
  useEffect(() => { d.audioSegments.forEach((s) => { const a = d.audioSegmentRefs.current.get(s.id); if (a) setTimelineAudioGain(a, getAudioSegmentPreviewVolume(s, d.currentTime), s.spatialEffect, s.spatialAmount); }); }, [d.audioSegments, d.currentTime]);
  useEffect(() => {
    syncVoiceAudioSegments({
      segments: d.audioSegments,
      refs: d.audioSegmentRefs,
      timelineTime: d.currentTime,
      isPlaying: d.isPlaying,
      visibility: d.trackVisibility,
    });
  }, [d.audioSegments, d.currentTime, d.isPlaying, d.trackVisibility]);
  useEffect(() => { if (d.sourceAudioRef.current) setTimelineAudioGain(d.sourceAudioRef.current, d.sourceAudioVolume, d.sourceAudioSpatialEffect, d.sourceAudioSpatialAmount); }, [d.sourceAudioSpatialAmount, d.sourceAudioSpatialEffect, d.sourceAudioVolume, d.sourceAudioUrl]);
  useEffect(() => {
    const a = d.sourceAudioRef.current; if (!a || !d.sourceAudioUrl) return;
    const state = d.sourceAudioLinked
      ? getLinkedSourceAudioState(d.linkedSourceAudioSegments || [], d.currentTime)
      : { active: isTimelineTimeInsideTrack(d.currentTime, d.sourceAudioStart, d.sourceAudioDuration), sourceTime: getTimelineTrackLocalTime(d.currentTime, d.sourceAudioStart, d.sourceAudioDuration), playbackRate: 1 };
    const play = d.isPlaying && d.trackVisibility?.source !== false && state.active;
    syncTimelineAudioElement(a, { active: state.active, shouldPlay: play, expectedTime: state.sourceTime, playbackRate: state.playbackRate, segmentKey: state.segment ? `${state.segment.id}:${state.segment.sourceStart}:${state.segment.start}` : "source" });
  }, [d.currentTime, d.isPlaying, d.linkedSourceAudioSegments, d.sourceAudioDuration, d.sourceAudioLinked, d.sourceAudioStart, d.sourceAudioUrl, d.trackVisibility.source]);
  useEffect(() => {
    const music = d.musicRef.current;
    if (!music) return;
    const segment = d.musicSegments?.find((item) => isTimelineTimeInsideTrack(d.currentTime, item.start, item.duration));
    setTimelineAudioGain(music, segment
      ? getAudioSegmentPreviewVolume({ ...segment, volume: segment.volume ?? d.musicVolume }, d.currentTime)
      : d.musicVolume, segment?.spatialEffect, segment?.spatialAmount);
  }, [d.currentTime, d.musicSegments, d.musicVolume, d.musicUrl]);
  useEffect(() => {
    const music = d.musicRef.current; if (!music || !d.musicUrl) return;
    const segments = d.musicSegments?.length ? d.musicSegments : [{ start: d.musicStart, duration: d.musicDuration, sourceStart: 0, playbackRate: 1 }];
    const segment = segments.find((item) => isTimelineTimeInsideTrack(d.currentTime, item.start, item.duration));
    const active = Boolean(segment);
    const playbackRate = Math.max(0.25, Math.min(4, Number(segment?.playbackRate) || 1));
    const expected = segment ? Math.max(0, Number(segment.sourceStart) || 0) + getTimelineTrackLocalTime(d.currentTime, segment.start, segment.duration) * playbackRate : 0;
    const play = d.isPlaying && d.trackVisibility?.music !== false && active;
    syncTimelineAudioElement(music, { active, shouldPlay: play, expectedTime: expected, playbackRate, segmentKey: segment ? `${segment.id}:${segment.sourceStart || 0}:${segment.start}` : "music" });
  }, [d.currentTime, d.isPlaying, d.musicDuration, d.musicSegments, d.musicStart, d.musicUrl, d.trackVisibility.music]);
  useEffect(() => { d.currentTimeRef.current = d.currentTime; }, [d.currentTime]);
  useEffect(() => {
    const v = d.previewVideoRef.current; if (!v || d.previewVisualType !== "video") return;
    const localTime = Math.max(0, d.currentTime - (d.previewVisualRange?.start || 0));
    const baseRate = getVisualPlaybackRateAtTime(d.previewVisualSegment, localTime);
    const expected = getVisualSourceTime(d.previewVisualSegment, localTime);
    v.playbackRate = d.isPlaying && !requiresTimelineDrivenVideoFrames(d.previewVisualSegment)
      ? previewPlaybackRate(v, expected, baseRate) : baseRate;
    if ("preservesPitch" in v) v.preservesPitch = true;
  }, [previewVideoNode, d.currentTime, d.previewVisualRange?.start, d.previewVisualSegment, d.previewVisualSrc, d.previewVisualType]);
  useEffect(() => {
    const previousSegment = previousPreviewVisualSegmentRef.current;
    previousPreviewVisualSegmentRef.current = d.previewVisualSegment ?? null;
    const v = d.previewVideoRef.current;
    if (!v || d.previewVisualType !== "video") {
      d.setPreviewVideoMediaTime(0);
      return;
    }
    const sourceStart = getVisualSourceTime(d.previewVisualSegment, Math.max(0, d.currentTimeRef.current - (d.previewVisualRange?.start || 0)));
    if (!shouldSeekPreviewVideoOnSegmentChange(
      previousSegment,
      d.previewVisualSegment,
      d.isPlaying,
    )) return;
    d.setPreviewVideoMediaTime(sourceStart);
    const max = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 0.001) : sourceStart;
    const time = Math.min(sourceStart, max);
    if (Number.isFinite(time) && Math.abs(v.currentTime - time) > 0.04) {
      requestLatestVideoFrame(v, time, {
        immediate: true,
        onPresented: d.setPreviewVideoMediaTime,
      });
    }
  }, [d.previewVisualSegment?.id, d.previewVisualSegment?.sourceStart, d.previewVisualSrc, d.previewVisualType]);
  useEffect(() => {
    const v = d.previewVideoRef.current; if (!v || d.previewVisualType !== "video") return;
    const max = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 0.001) : d.previewVisualSourceTime;
    const time = Math.min(Math.max(0, d.previewVisualSourceTime), max);
    const frameDriven = requiresTimelineDrivenVideoFrames(d.previewVisualSegment);
    if (shouldCorrectPreviewMediaTime({
      isPlaying: d.isPlaying && !frameDriven,
      currentTime: v.currentTime,
      targetTime: time,
    })) {
      requestLatestVideoFrame(v, time, {
        onPresented: d.setPreviewVideoMediaTime,
      });
    }
  }, [previewVideoNode, d.isPlaying, d.previewVisualSegment?.id, d.previewVisualSourceTime, d.previewVisualSrc, d.previewVisualType]);
  useEffect(() => {
    const v = d.previewVideoRef.current; if (!v || d.previewVisualType !== "video") return;
    if (!shouldUseNativeVisualPlayback(
      d.previewVisualSegment,
      d.isPlaying,
      d.trackVisibility?.image !== false,
    )) v.pause();
    else requestTimelineMediaPlay(v);
  }, [previewVideoNode, d.isPlaying, d.previewVisualSegment?.id, d.previewVisualSrc, d.previewVisualType, d.trackVisibility.image]);
  useEffect(() => {
    if (!d.isPlaying || d.estimatedDuration <= 0) return undefined;
    const start = d.currentTimeRef.current >= d.estimatedDuration - 0.02 ? 0 : Math.max(0, d.currentTimeRef.current);
    if (start !== d.currentTimeRef.current) { d.setCurrentTime(start); d.currentTimeRef.current = start; }
    d.visualPlaybackStartTimeRef.current = start; d.visualPlaybackStartedAtRef.current = performance.now(); d.visualPlaybackLastUpdateRef.current = 0;
    const tick = (now) => {
      const wallClockTime = Math.min(
        d.estimatedDuration,
        d.visualPlaybackStartTimeRef.current + (now - d.visualPlaybackStartedAtRef.current) / 1000,
      );
      // The timeline is the monotonic master clock. A video element can stall
      // just before `ended` while decoding its tail; using that media time as
      // the clock pins the playhead inside one clip and appears to loop it.
      // Video/audio elements are synchronized to this clock, never vice versa.
      const next = wallClockTime;
      d.currentTimeRef.current = next;
      if (now - d.visualPlaybackLastUpdateRef.current > PLAYBACK_UI_FRAME_MS || next >= d.estimatedDuration) {
        d.visualPlaybackLastUpdateRef.current = now;
        d.setCurrentTime(next);
      }
      if (next >= d.estimatedDuration) { d.pauseTimelineMedia(); d.setIsPlaying(false); d.visualPlaybackFrameRef.current = 0; return; }
      d.visualPlaybackFrameRef.current = requestAnimationFrame(tick);
    };
    d.visualPlaybackFrameRef.current = requestAnimationFrame(tick);
    return () => { if (d.visualPlaybackFrameRef.current) { cancelAnimationFrame(d.visualPlaybackFrameRef.current); d.visualPlaybackFrameRef.current = 0; } };
  }, [d.estimatedDuration, d.isPlaying]);
  useEffect(() => { d.setCurrentTime((time) => {
    const clamped = Math.min(time, d.timelineDuration);
    if (d.audioRef.current && clamped !== time) d.audioRef.current.currentTime = clamped;
    if (d.sourceAudioRef.current && clamped !== time) d.sourceAudioRef.current.currentTime = d.sourceAudioLinked
      ? getLinkedSourceAudioState(d.linkedSourceAudioSegments || [], clamped).sourceTime
      : getTimelineTrackLocalTime(clamped, d.sourceAudioStart, d.sourceAudioDuration);
    if (d.musicRef.current && clamped !== time) {
      const segment = d.musicSegments?.find((item) => isTimelineTimeInsideTrack(clamped, item.start, item.duration));
      const playbackRate = Math.max(0.25, Math.min(4, Number(segment?.playbackRate) || 1));
      d.musicRef.current.currentTime = segment
        ? Math.max(0, Number(segment.sourceStart) || 0) + getTimelineTrackLocalTime(clamped, segment.start, segment.duration) * playbackRate
        : getTimelineTrackLocalTime(clamped, d.musicStart, d.musicDuration);
    }
    return clamped;
  }); }, [d.linkedSourceAudioSegments, d.musicDuration, d.musicSegments, d.musicStart, d.sourceAudioDuration, d.sourceAudioLinked, d.sourceAudioStart, d.timelineDuration]);
  return attachPreviewVideo;
}

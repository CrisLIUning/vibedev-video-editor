import {
  IMAGE_SNAP_THRESHOLD_PIXELS, MAX_TIMELINE_DURATION_SECONDS, MIN_VISUAL_SEGMENT_SECONDS,
} from "../config/editor.js";
import { createVisualSegment, getVisualSegmentsTotal } from "./timeline.js";
import { createTimelineSnapGuide } from "./timelineSnap.js";
import { trimClipRange } from "./clipSourceRange.js";
import { createTimelineEdgeAutoScroller, getTimelineActiveDragHorizon, getTimelineDragTimeDelta, settleTimelineDrag } from "./timelineEdgeAutoScroll.js";

/** A trim is one authored edit. Pointer frames are view state, not saved history. */
export function createImageResizeControl(d) {
  return function startImageResize(event, segmentId = "", segmentIndex = -1, edge = "end") {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (d.trackLocks.image) return void d.notify("画面轨已锁定，无法裁剪");
    if (!d.imageSrc || d.timelineDuration <= 0) return void d.notify("请先上传或选择图片/视频素材");
    d.trimGestureRef.current?.();
    const baseline = d.visualSegments;
    const segments = baseline.length ? baseline : [createVisualSegment(d.imageDuration || 4, d.getCurrentVisualAssetSnapshot())];
    const idIndex = segments.findIndex(segment => segment.id === segmentId);
    const index = idIndex >= 0 ? idIndex : segmentIndex >= 0 && segmentIndex < segments.length ? segmentIndex : segments.length - 1;
    const original = segments[index];
    const before = getVisualSegmentsTotal(segments.slice(0, index));
    const after = getVisualSegmentsTotal(segments.slice(index + 1));
    const rect = d.trackScrollRef.current?.getBoundingClientRect();
    if (!original || !rect?.width) return;
    const timelineDuration = Math.max(10, d.timelineDurationRef.current || d.timelineDuration);
    const maxDuration = Math.max(MIN_VISUAL_SEGMENT_SECONDS, MAX_TIMELINE_DURATION_SECONDS - before - after);
    const initialEdgeTime = before + (edge === "start" ? 0 : original.duration);
    const snapPoints = [
      d.audioBlob && d.audioDuration > 0 ? { time: d.audioDuration, label: "配音结尾" } : null,
      d.sourceAudioBlob && d.sourceAudioDuration > 0 ? { time: d.sourceAudioStart + d.sourceAudioDuration, label: "原声结尾" } : null,
      d.musicBlob && d.musicDuration > 0 ? { time: (d.musicStart || 0) + d.musicDuration, label: "音乐结尾" } : null,
    ].filter(Boolean);
    let moved = false, done = false, frameId = 0, pending = null, limited = false;
    let nextSegments = segments;
    const contextIsCurrent = () => d.currentTrimContext.current.visualSegments === baseline && !d.currentTrimContext.current.locked;
    const autoScroller = createTimelineEdgeAutoScroller({
      trackElement: d.trackScrollRef.current, pointerType: event.pointerType, timelineDuration,
      // The scroller already runs in RAF and needs the preview width before it
      // measures the next scroll limit. Do not defer this callback another frame.
      onScrollFrame: (clientX, scrollOffset) => { pending = [clientX, scrollOffset]; flush(); },
    });
    // Use a delta from pointer-down; grabbing anywhere within the handle must
    // not jump the cut, including after zoom or horizontal scrolling.
    const dragClientX = clientX => edge === "start" ? clientX : autoScroller.getDragClientX(clientX);
    const initialClientX = dragClientX(event.clientX);
    const apply = (clientX, scrollOffset) => {
      if (done) return;
      if (!contextIsCurrent()) return cancel();
      const delta = getTimelineDragTimeDelta({ clientX: dragClientX(clientX), startX: initialClientX,
        scrollOffset, contentWidth: rect.width, timelineDuration });
      const raw = initialEdgeTime + delta;
      const snap = snapPoints.map(point => ({ ...point, distance: Math.abs(raw - point.time) * rect.width / timelineDuration }))
        .filter(point => point.distance <= IMAGE_SNAP_THRESHOLD_PIXELS).sort((a, b) => a.distance - b.distance)[0] ?? null;
      const target = snap?.time ?? raw;
      const requestedDuration = Math.max(MIN_VISUAL_SEGMENT_SECONDS, Math.min(maxDuration,
        edge === "start" ? original.duration - (target - before) : target - before));
      const trimmed = edge === "start"
        ? trimClipRange(original, original.duration - requestedDuration, original.duration)
        : trimClipRange(original, 0, requestedDuration);
      limited = Math.abs(trimmed.duration - requestedDuration) > 0.001;
      nextSegments = segments.map((segment, position) => position === index ? trimmed : segment);
      d.setTimelineHorizon(value => getTimelineActiveDragHorizon(value, timelineDuration, getVisualSegmentsTotal(nextSegments)));
      d.setSnapGuide(limited ? null : createTimelineSnapGuide(snap, edge));
      d.setTimelineClipDrag({ track: "image", mode: "trim", edge, segmentId: original.id, dragging: true, previewSegments: nextSegments });
    };
    const flush = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      const latest = pending; pending = null;
      if (latest) apply(...latest);
    };
    const schedule = (clientX, scrollOffset = autoScroller.getScrollOffset()) => {
      pending = [clientX, scrollOffset];
      if (!frameId) frameId = window.requestAnimationFrame(flush);
    };
    const move = e => {
      if (!moved && Math.abs(e.clientX - event.clientX) < 3) return;
      if (!moved) { moved = true; d.pauseForTimelineEdit?.(); }
      autoScroller.update(e.clientX);
      schedule(e.clientX);
    };
    const cleanup = () => {
      done = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0; pending = null;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      if (d.trimGestureRef.current === cancel) d.trimGestureRef.current = null;
    };
    const finish = commit => {
      if (done) return;
      cleanup();
      settleTimelineDrag(autoScroller, { active: moved, setTimelineHorizon: d.setTimelineHorizon, settle: () => {
        d.setTimelineClipDrag(null); d.setSnapGuide(null);
        if (commit && nextSegments[index] !== original) {
          d.commitVisualSegments(nextSegments, "已裁剪片段，播放速度保持不变", index);
        } else if (commit && limited) {
          d.notify(original.speedCurve?.enabled || original.vibedevTimeRemapRuntime?.segments?.length
            ? "变速曲线、倒放或定格片段暂不支持向外恢复；可撤销上次裁剪"
            : "已到源素材边界，无法继续恢复");
        }
      } });
      // A click without a drag does not activate the scale settlement callback.
      if (!moved) { d.setTimelineClipDrag(null); d.setSnapGuide(null); }
    };
    const cancel = () => finish(false);
    const key = e => { if (e.key === "Escape") { e.preventDefault(); cancel(); } };
    const up = () => { flush(); if (!done) finish(moved && contextIsCurrent()); };
    d.setSelectedTrack("image"); d.setSelectedVisualSegmentId(original.id);
    d.trimGestureRef.current = cancel;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel); window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
  };
}

import { flushSync } from "react-dom";
import { editorViewportMatches } from "./embeddedDom.js";

const trimScaleGenerations = new WeakMap();
export const TIMELINE_TRIM_SCALE_START_EVENT = "timeline-trim-scale-start";
export const TIMELINE_TRIM_SCALE_END_EVENT = "timeline-trim-scale-end";

export function getTimelineDragTimeDelta({ clientX, startX, scrollOffset = 0, contentWidth, timelineDuration }) {
  if (![clientX, startX, scrollOffset, contentWidth, timelineDuration].every(Number.isFinite) || contentWidth <= 0) return 0;
  return ((clientX - startX + scrollOffset) / contentWidth) * timelineDuration;
}

export function getTrimLockedTrackWidth(timelineDuration, pixelsPerSecond) {
  const duration = Math.max(0, Number(timelineDuration) || 0);
  const scale = Math.max(0, Number(pixelsPerSecond) || 0);
  return duration * scale;
}

export function getTimelineTrimDragClientX(clientX, rect, inset = 10) {
  if (!rect || !Number.isFinite(clientX) || !(rect.width > 0)) return clientX;
  const safeInset = Math.max(0, Math.min(rect.width / 2, Number(inset) || 0));
  return Math.max(rect.left + safeInset, Math.min(rect.right - safeInset, clientX));
}

export function getMobileTrimReleaseScrollLeft(scrollLeft, trackWidth) {
  const current = Math.max(0, Number(scrollLeft) || 0);
  const width = Math.max(0, Number(trackWidth) || 0);
  return width > 0 ? Math.min(current, width) : current;
}

export function getTimelineReleaseHorizon(trackElement, timelineDuration, minimumDuration = 10) {
  const scrollElement = trackElement?.parentElement;
  const contentWidth = trackElement?.getBoundingClientRect?.().width || trackElement?.clientWidth || 0;
  const duration = Math.max(0, Number(timelineDuration) || 0);
  const minimum = Math.max(0, Number(minimumDuration) || 0);
  if (!scrollElement || !(contentWidth > 0) || !(duration > 0)) return Math.max(minimum, duration);
  const visibleEnd = ((scrollElement.scrollLeft + scrollElement.clientWidth) / contentWidth) * duration;
  return Math.max(minimum, Math.ceil(visibleEnd * 2) / 2);
}

export function getTimelineActiveDragHorizon(currentHorizon, dragStartDuration, contentEnd = 0) {
  return Math.max(
    0,
    Number(currentHorizon) || 0,
    Number(dragStartDuration) || 0,
    Number(contentEnd) || 0,
  );
}

/**
 * Finish a timeline edit as one state transition. During an active drag the
 * content mutation, release horizon and scale unlock must reach React in the
 * same flush; otherwise the track briefly renders one of the intermediate
 * geometries and the scrollbar visibly converges over repeated releases.
 */
export function settleTimelineDrag(autoScroller, {
  active = false,
  setTimelineHorizon,
  settle,
} = {}) {
  if (!active) {
    autoScroller?.stop();
    return null;
  }
  const releaseHorizon = autoScroller?.getReleaseHorizon?.();
  autoScroller?.stop(() => {
    settle?.();
    if (Number.isFinite(releaseHorizon)) setTimelineHorizon?.(releaseHorizon);
  });
  return releaseHorizon;
}

export function getTimelineEdgeAutoScrollStep(clientX, rect, {
  threshold = 48,
  forwardMaxStep = 14,
  backwardMaxStep = 6,
  minStep = 0.35,
  curvePower = 2,
} = {}) {
  if (!rect || !Number.isFinite(clientX) || rect.width <= 0) return 0;
  const getStep = (distanceFromEdge, maxStep) => {
    const strength = Math.min(1, Math.max(0, (threshold - Math.max(0, distanceFromEdge)) / threshold));
    if (strength <= 0) return 0;
    return Math.max(0, minStep, strength ** curvePower * maxStep);
  };
  if (clientX < rect.left + threshold) {
    return -getStep(clientX - rect.left, backwardMaxStep);
  }
  if (clientX > rect.right - threshold) {
    return getStep(rect.right - clientX, forwardMaxStep);
  }
  return 0;
}

export function createTimelineVerticalEdgeAutoScroller({
  scrollElement,
  pointerType,
  onScrollFrame,
  edgeScrollOptions = {
    threshold: 72,
    forwardMaxStep: 14,
    backwardMaxStep: 8,
    minStep: 0.5,
    curvePower: 2,
  },
  win = globalThis.window,
} = {}) {
  const isMobile = editorViewportMatches(scrollElement, { maxWidth: 760 });
  const enabled = Boolean(scrollElement) && ["mouse", "pen"].includes(pointerType) && !isMobile;
  let latestClientY = 0;
  let frameId = 0;

  const tick = () => {
    frameId = 0;
    if (!enabled) return;
    const rect = scrollElement.getBoundingClientRect();
    const step = getTimelineEdgeAutoScrollStep(latestClientY, {
      left: rect.top,
      right: rect.bottom,
      width: rect.height,
    }, edgeScrollOptions);
    if (!step) return;
    const before = scrollElement.scrollTop;
    const maximum = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    scrollElement.scrollTop = Math.max(0, Math.min(maximum, before + step));
    const delta = scrollElement.scrollTop - before;
    if (delta) onScrollFrame?.(latestClientY, delta);
    const after = scrollElement.scrollTop;
    if (!frameId && ((step < 0 && after > 0) || (step > 0 && after < maximum))) {
      frameId = win.requestAnimationFrame(tick);
    }
  };

  return {
    update(clientY) {
      latestClientY = clientY;
      if (enabled && !frameId) frameId = win.requestAnimationFrame(tick);
    },
    stop() {
      if (frameId) win.cancelAnimationFrame(frameId);
      frameId = 0;
    },
  };
}

export function createTimelineEdgeAutoScroller({
  trackElement,
  pointerType,
  timelineDuration = 0,
  onScrollFrame,
  manageTrimScale = true,
  edgeScrollOptions,
  win = globalThis.window,
} = {}) {
  const scrollElement = trackElement?.parentElement;
  const isMobile = editorViewportMatches(trackElement, { maxWidth: 760 });
  const enabled = Boolean(scrollElement) && (
    (pointerType === "touch" && isMobile)
    || (["mouse", "pen"].includes(pointerType) && !isMobile)
  );
  const rulerElement = enabled && manageTrimScale
    ? trackElement.closest?.(".timeline-board")?.querySelector?.(".timeline-ruler-canvas")
    : null;
  let previousContentWidth = trackElement?.getBoundingClientRect?.().width || trackElement?.clientWidth || 0;
  const dragPixelsPerSecond = previousContentWidth > 0 && timelineDuration > 0
    ? previousContentWidth / timelineDuration
    : 0;
  let logicalScrollOffset = 0;
  let latestClientX = 0;
  let frameId = 0;
  let phase = "pending";

  const activateTrimScale = () => {
    if (!enabled || phase !== "pending") return;
    phase = "dragging";
    if (!manageTrimScale) return;
    trimScaleGenerations.set(trackElement, (trimScaleGenerations.get(trackElement) || 0) + 1);
    trackElement.classList?.add("is-trimming");
    rulerElement?.classList?.add("is-trimming");
    const contentWidth = trackElement.getBoundingClientRect?.().width || trackElement.clientWidth || 0;
    const viewportWidth = scrollElement.clientWidth || contentWidth;
    if (contentWidth > 0 && timelineDuration > 0 && win?.dispatchEvent && win?.CustomEvent) {
      flushSync(() => win.dispatchEvent(new win.CustomEvent(TIMELINE_TRIM_SCALE_START_EVENT, {
        detail: {
          pixelsPerSecond: contentWidth / timelineDuration,
          visibleDuration: (viewportWidth * timelineDuration) / contentWidth,
        },
      })));
    }
  };

  const syncContentWidth = () => {
    if (!enabled) return;
    const nextContentWidth = trackElement?.getBoundingClientRect?.().width || trackElement?.clientWidth || previousContentWidth;
    previousContentWidth = nextContentWidth;
  };

  const tick = () => {
    frameId = 0;
    if (!enabled) return;
    syncContentWidth();
    const rect = scrollElement.getBoundingClientRect();
    const step = getTimelineEdgeAutoScrollStep(latestClientX, rect, edgeScrollOptions);
    if (!step) return;
    const before = scrollElement.scrollLeft;
    const requestedScrollDelta = step < 0 ? Math.max(-before, step) : step;
    if (requestedScrollDelta) {
      flushSync(() => onScrollFrame?.(latestClientX, logicalScrollOffset + requestedScrollDelta));
      syncContentWidth();
      const maximumAfterUpdate = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth);
      const beforeEdgeScroll = scrollElement.scrollLeft;
      scrollElement.scrollLeft = Math.max(0, Math.min(maximumAfterUpdate, beforeEdgeScroll + requestedScrollDelta));
      logicalScrollOffset += scrollElement.scrollLeft - beforeEdgeScroll;
    }
    const after = scrollElement.scrollLeft;
    const maximum = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth);
    if (!frameId && ((step < 0 && after > 0) || (step > 0 && after < maximum))) frameId = win.requestAnimationFrame(tick);
  };

  return {
    update(clientX) {
      latestClientX = clientX;
      activateTrimScale();
      if (enabled && !frameId) frameId = win.requestAnimationFrame(tick);
    },
    getScrollOffset() {
      return enabled ? logicalScrollOffset : 0;
    },
    getDragClientX(clientX) {
      return enabled
        ? getTimelineTrimDragClientX(clientX, scrollElement.getBoundingClientRect())
        : clientX;
    },
    getReleaseHorizon(minimumDuration = 10) {
      const minimum = Math.max(0, Number(minimumDuration) || 0);
      if (!scrollElement || !(dragPixelsPerSecond > 0)) return Math.max(minimum, timelineDuration);
      const visibleEnd = (scrollElement.scrollLeft + scrollElement.clientWidth) / dragPixelsPerSecond;
      return Math.max(minimum, Math.ceil(visibleEnd * 2) / 2);
    },
    stop(settle) {
      if (frameId) win.cancelAnimationFrame(frameId);
      frameId = 0;
      const anchoredScrollLeft = Math.max(0, Number(scrollElement?.scrollLeft) || 0);
      const trimScaleActive = phase === "dragging" && manageTrimScale;
      const settleAndUnlock = () => {
        settle?.();
        if (trimScaleActive && win?.dispatchEvent && win?.CustomEvent) {
          win.dispatchEvent(new win.CustomEvent(TIMELINE_TRIM_SCALE_END_EVENT));
        }
      };
      if (trimScaleActive) flushSync(settleAndUnlock);
      else settleAndUnlock();
      if (trimScaleActive) {
        const trimGeneration = trimScaleGenerations.get(trackElement);
        const removeTransitionGuard = () => {
          if (trimScaleGenerations.get(trackElement) !== trimGeneration) return;
          trackElement?.classList?.remove("is-trimming");
          rulerElement?.classList?.remove("is-trimming");
        };
        // React has committed the atomic release, but ResizeObserver-derived
        // geometry can still publish in the next frame. Keep width transitions
        // disabled through that frame so the settled audio clip never eases to
        // the same pixel position after the pointer is already up.
        if (win?.requestAnimationFrame) win.requestAnimationFrame(removeTransitionGuard);
        else removeTransitionGuard();
      }
      phase = "settled";
      syncContentWidth();
      if (scrollElement) {
        const maximum = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth);
        const nextScrollLeft = Math.min(anchoredScrollLeft, maximum);
        scrollElement.scrollLeft = isMobile
          ? getMobileTrimReleaseScrollLeft(nextScrollLeft, previousContentWidth)
          : nextScrollLeft;
      }
    },
  };
}

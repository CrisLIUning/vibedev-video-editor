const videoSeekStates = new WeakMap();

function getSeekState(video) {
  let state = videoSeekStates.get(video);
  if (!state) {
    state = {
      version: 0,
      targetTime: 0,
      frameRequest: 0,
      frameGeneration: 0,
      videoFrameRequest: 0,
      presentedFrameRequest: 0,
      seekListener: null,
      pending: false,
      presentedCallback: null,
    };
    videoSeekStates.set(video, state);
  }
  return state;
}

function clearPresentedFrameWait(video, state) {
  if (state.videoFrameRequest) video.cancelVideoFrameCallback?.(state.videoFrameRequest);
  if (state.presentedFrameRequest) window.cancelAnimationFrame(state.presentedFrameRequest);
  if (state.seekListener) video.removeEventListener("seeked", state.seekListener);
  state.videoFrameRequest = 0;
  state.presentedFrameRequest = 0;
  state.seekListener = null;
}

function watchPresentedFrame(video, state, version) {
  if (typeof video.requestVideoFrameCallback !== "function") {
    const present = () => {
      if (state.version !== version) return;
      state.presentedFrameRequest = 0;
      state.pending = false;
      state.presentedCallback?.(video.currentTime);
    };
    if (video.seeking) {
      state.seekListener = () => {
        if (state.version !== version) return;
        state.seekListener = null;
        state.presentedFrameRequest = window.requestAnimationFrame(present);
      };
      video.addEventListener("seeked", state.seekListener, { once: true });
    } else state.presentedFrameRequest = window.requestAnimationFrame(present);
    return;
  }

  const handleFrame = (_now, metadata) => {
    if (state.version !== version) return;
    state.videoFrameRequest = 0;
    const mediaTime = Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime : video.currentTime;
    if (!video.seeking) {
      state.pending = false;
      state.presentedCallback?.(mediaTime);
      return;
    }
    state.videoFrameRequest = video.requestVideoFrameCallback(handleFrame);
  };
  state.videoFrameRequest = video.requestVideoFrameCallback(handleFrame);
}

function applyLatestSeek(video, state) {
  state.frameRequest = 0;
  if (!state.pending) return;
  const version = state.version;
  const targetTime = state.targetTime;
  if (!Number.isFinite(targetTime)) return;
  clearPresentedFrameWait(video, state);
  if (Math.abs(video.currentTime - targetTime) > 0.002) video.currentTime = targetTime;
  watchPresentedFrame(video, state, version);
}

export function requestLatestVideoFrame(video, targetTime, options = {}) {
  if (!video || !Number.isFinite(targetTime)) return;
  const state = getSeekState(video);
  const target = Math.max(0, targetTime);
  state.presentedCallback = typeof options.onPresented === "function" ? options.onPresented : null;
  // React effects and pointer release can ask for the very same in-flight
  // target. Keep its decoder/frame wait; only replace the callback consumer.
  if (state.pending && Math.abs(state.targetTime - target) < 0.002
    && (state.frameRequest || video.seeking || Math.abs(video.currentTime - target) < 0.002)) {
    if (options.immediate && state.frameRequest) {
      window.cancelAnimationFrame(state.frameRequest);
      state.frameGeneration += 1;
      applyLatestSeek(video, state);
    }
    return;
  }
  state.version += 1;
  state.targetTime = target;
  state.pending = true;
  clearPresentedFrameWait(video, state);
  if (options.immediate) {
    if (state.frameRequest) window.cancelAnimationFrame(state.frameRequest);
    state.frameGeneration += 1;
    applyLatestSeek(video, state);
    return;
  }
  if (!state.frameRequest) {
    const generation = ++state.frameGeneration;
    state.frameRequest = window.requestAnimationFrame(() => {
      if (state.frameGeneration === generation) applyLatestSeek(video, state);
    });
  }
}

export function cancelLatestVideoFrameRequest(video) {
  const state = video && videoSeekStates.get(video);
  if (!state) return;
  state.version += 1;
  state.frameGeneration += 1;
  if (state.frameRequest) window.cancelAnimationFrame(state.frameRequest);
  clearPresentedFrameWait(video, state);
  state.frameRequest = 0;
  state.pending = false;
  state.presentedCallback = null;
}

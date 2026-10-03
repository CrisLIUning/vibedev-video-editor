// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { React, createRoot } from './upstream-react-harness.js';
import { useMediaSync } from '../../../vendor/ai-video-editor/src/hooks/useMediaSync.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([{ playing: true, reverse: false }, { playing: false, reverse: false }, { playing: true, reverse: true }])('preserves playback and source position across portal replacements: %j', async ({ playing, reverse }) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const ref = () => ({ current: null });
  const state = {
    audioRef: ref(), audioSegmentRefs: { current: new Map() }, audioSegments: [],
    sourceAudioRef: ref(), musicRef: ref(), previewVideoRef: ref(),
    currentTime: 5, currentTimeRef: { current: 5 }, isPlaying: playing,
    previewVisualSegment: { id: 'trimmed', sourceStart: 7, playbackRate: 2, ...(reverse ? { vibedevTimeRemapRuntime: { segments: [{ kind: 'speed', reverse: true, rate: 2, durationSeconds: 10, sourceInSeconds: 27, sourceOutSeconds: 7 }] } } : {}) },
    previewVisualRange: { start: 0 }, previewVisualSrc: '/same.mp4', previewVisualType: 'video',
    previewVisualSourceTime: 17, trackVisibility: {}, musicSegments: [],
    estimatedDuration: 30, timelineDuration: 30,
    visualPlaybackStartTimeRef: ref(), visualPlaybackStartedAtRef: ref(), visualPlaybackLastUpdateRef: ref(), visualPlaybackFrameRef: ref(),
    setPreviewVideoMediaTime: vi.fn(), setCurrentTime: vi.fn(), setIsPlaying: vi.fn(), pauseTimelineMedia: vi.fn(),
  };
  function Harness({ expanded }: { expanded: number }) {
    const attach = useMediaSync(state);
    return React.createElement('video', { key: expanded, ref: attach });
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    for (const expanded of [0, 1, 2]) {
      play.mockClear();
      await React.act(() => root.render(React.createElement(Harness, { expanded })));
      const video = container.querySelector('video')!;
      Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
      await React.act(() => video.dispatchEvent(new Event('loadedmetadata')));
      expect(video.currentTime).toBe(17);
      expect(video.playbackRate).toBe(2);
      if (playing && !reverse) expect(play).toHaveBeenCalled();
      else expect(play).not.toHaveBeenCalled();
    }
  } finally { await React.act(() => root.unmount()); }
});

it('does not re-seek a running preview when canplay follows a seek or a buffering recovery', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const ref = () => ({ current: null });
  const state = {
    audioRef: ref(), audioSegmentRefs: { current: new Map() }, audioSegments: [],
    sourceAudioRef: ref(), musicRef: ref(), previewVideoRef: ref(),
    currentTime: 5, currentTimeRef: { current: 5 }, isPlaying: true,
    previewVisualSegment: { id: 'trimmed', sourceStart: 7, playbackRate: 2 },
    previewVisualRange: { start: 0 }, previewVisualSrc: '/same.mp4', previewVisualType: 'video',
    previewVisualSourceTime: 17, trackVisibility: {}, musicSegments: [],
    estimatedDuration: 30, timelineDuration: 30,
    visualPlaybackStartTimeRef: ref(), visualPlaybackStartedAtRef: ref(), visualPlaybackLastUpdateRef: ref(), visualPlaybackFrameRef: ref(),
    setPreviewVideoMediaTime: vi.fn(), setCurrentTime: vi.fn(), setIsPlaying: vi.fn(), pauseTimelineMedia: vi.fn(),
  };
  function Harness() {
    const attach = useMediaSync(state);
    return React.createElement('video', { ref: attach });
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(() => root.render(React.createElement(Harness)));
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    await React.act(() => video.dispatchEvent(new Event('loadedmetadata')));
    // Bound while playing: aligned and started.
    expect(video.currentTime).toBe(17);
    expect(play).toHaveBeenCalled();
    const startedPlays = play.mock.calls.length;
    // The native clock is running now (jsdom never flips `paused` itself).
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    video.currentTime = 17.2;
    state.previewVisualSourceTime = 17.35; // the throttled React clock is a seek's latency ahead
    await React.act(() => video.dispatchEvent(new Event('canplay')));
    expect(video.currentTime).toBe(17.2);
    expect(play.mock.calls.length).toBe(startedPlays);
  } finally { await React.act(() => root.unmount()); }
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPlaybackControls } from '../../../vendor/ai-video-editor/src/lib/playbackControls.js';

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => { window.dispatchEvent(new Event('pointercancel')); vi.restoreAllMocks(); });
function harness(playing = true) {
  const media = () => {
    const element = document.createElement('video');
    Object.defineProperty(element, 'duration', { value: 30 });
    const play = vi.spyOn(element, 'play').mockResolvedValue();
    const pause = vi.spyOn(element, 'pause').mockImplementation(() => {});
    return { element, play, pause };
  };
  const video = media(), voice = media(), source = media(), music = media();
  const visual = { id: 'v', type: 'video', start: 0, duration: 10, sourceStart: 4, sourceDuration: 20, playbackRate: 2 };
  const deps = {
    isPlaying: playing, setIsPlaying: vi.fn(), currentTimeRef: { current: 8 }, setCurrentTime: vi.fn(),
    timelineDuration: 10, timelineDurationRef: { current: 10 }, previewVideoRef: { current: video.element },
    previewVisualType: 'video', previewVisualSegment: visual, visualSegments: [visual], visualTimeline: [{ start: 0, end: 10 }],
    audioSegments: [{ id: 'voice', start: 0, duration: 10, sourceStart: 2, playbackRate: 1 }],
    audioSegmentRefs: { current: new Map([['voice', voice.element]]) },
    sourceAudioRef: { current: source.element }, sourceAudioStart: 0, sourceAudioDuration: 10,
    musicRef: { current: music.element }, musicStart: 0, musicDuration: 10,
    visualPlaybackStartTimeRef: { current: 8 }, visualPlaybackStartedAtRef: { current: 0 }, visualPlaybackLastUpdateRef: { current: 0 },
    trackScrollRef: { current: { getBoundingClientRect: () => ({ left: 100, width: 1000 }) } },
  };
  return { deps, controls: createPlaybackControls(deps), video, voice, source, music };
}

it('keeps all media paused on pointerup even though the gesture retains a playing render', () => {
  const h = harness();
  h.controls.startTimelineSeek({ button: 0, clientX: 500, preventDefault() {}, stopPropagation() {} });
  expect(h.deps.setIsPlaying).toHaveBeenCalledWith(false);
  // The down handler's closures intentionally still see isPlaying=true,
  // including after the React pause effect has already run.
  expect(h.deps.isPlaying).toBe(true);
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 300 }));
  for (const media of [h.video, h.voice, h.source, h.music]) {
    expect(media.pause).toHaveBeenCalled(); expect(media.play).not.toHaveBeenCalled();
  }
  expect(h.deps.currentTimeRef.current).toBe(2);
  expect(h.video.element.currentTime).toBe(8); // sourceStart 4 + 2 seconds at 2x
  expect(h.voice.element.currentTime).toBe(4);
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 800 }));
  expect(h.deps.currentTimeRef.current).toBe(2);
});

it('cancels the scrub listeners without restarting media or accepting late pointer moves', () => {
  const h = harness();
  h.controls.startTimelineSeek({ button: 0, clientX: 500, preventDefault() {}, stopPropagation() {} });
  window.dispatchEvent(new Event('pointercancel'));
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 800 }));
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 900 }));
  expect(h.deps.currentTimeRef.current).toBe(4);
  expect(h.video.play).not.toHaveBeenCalled();
});

it('retains intentional continuous playback for an ordinary seek while playing', () => {
  const h = harness(); h.controls.seekTo(2, { immediate: true });
  expect(h.video.play).toHaveBeenCalledOnce();
  expect(h.video.element.currentTime).toBe(8);
  expect(h.deps.visualPlaybackStartTimeRef.current).toBe(2);
});

it('aligns the preview video before play() when resuming from a scrubbed position', () => {
  const h = harness(false);
  Object.assign(h.deps, { canPreview: true, notify: vi.fn(), estimatedDuration: 10, sourceAudioUrl: '', musicUrl: '' });
  // Left one frame away from where the timeline stands (8s -> source 20s).
  h.video.element.currentTime = 19.97;
  let sourceTimeWhenPlayCalled = -1;
  h.video.play.mockImplementation(() => { sourceTimeWhenPlayCalled = h.video.element.currentTime; return Promise.resolve(); });
  h.controls.handlePlayToggle();
  expect(h.video.play).toHaveBeenCalledOnce();
  expect(sourceTimeWhenPlayCalled).toBe(20);
  expect(h.deps.setIsPlaying).toHaveBeenCalledWith(true);
});

it('does not start media when seeking an already paused timeline', () => {
  const h = harness(false); h.controls.seekTo(2, { immediate: true });
  expect(h.video.play).not.toHaveBeenCalled(); expect(h.video.element.currentTime).toBe(8);
});

it('coalesces the whole scrub, including audio and React time, and flushes the release position', () => {
  const h = harness(false);
  const voiceSeek = vi.spyOn(h.voice.element, 'currentTime', 'set');
  h.controls.startTimelineSeek({ button: 0, clientX: 300, preventDefault() {}, stopPropagation() {} });
  h.deps.setCurrentTime.mockClear(); voiceSeek.mockClear();
  for (let x = 310; x <= 900; x += 10) window.dispatchEvent(new MouseEvent('pointermove', { clientX: x }));
  expect(h.deps.setCurrentTime).not.toHaveBeenCalled();
  expect(voiceSeek).not.toHaveBeenCalled();
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 950 }));
  expect(h.deps.setCurrentTime).toHaveBeenCalledExactlyOnceWith(8.5);
  expect(voiceSeek).toHaveBeenCalledExactlyOnceWith(10.5);
});

it.each(['blur', 'escape'])('ends a scrub on %s and ignores late pointer events', cause => {
  const h = harness(false);
  h.controls.startTimelineSeek({ button: 0, clientX: 300, preventDefault() {}, stopPropagation() {} });
  window.dispatchEvent(cause === 'escape' ? new KeyboardEvent('keydown', { key: 'Escape' }) : new Event(cause));
  h.deps.setCurrentTime.mockClear();
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 800 }));
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 900 }));
  expect(h.deps.setCurrentTime).not.toHaveBeenCalled();
});

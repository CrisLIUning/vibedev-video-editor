// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createImageResizeControl } from '../../../vendor/ai-video-editor/src/lib/imageResizeControl.js';

afterEach(() => { window.dispatchEvent(new Event('pointercancel')); vi.restoreAllMocks(); });

function harness() {
  const clip = { id: 'v', type: 'video', duration: 6, sourceStart: 4, sourceDuration: 12, sourceMediaDuration: 20, playbackRate: 2 };
  const clips = [clip, { ...clip, id: 'next' }];
  const d = {
    trackLocks: { image: false }, imageSrc: '/clip.mp4', imageDuration: 12,
    visualSegments: clips, visualSegmentsRef: { current: clips },
    timelineDuration: 20, timelineDurationRef: { current: 20 },
    trackScrollRef: { current: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) } },
    captionDuration: 0, script: '',
    setSelectedTrack: vi.fn(), setSelectedVisualSegmentId: vi.fn(),
    setSnapGuide: vi.fn(), setVisualSegments: vi.fn(), setImageDuration: vi.fn(),
    setImageClipCount: vi.fn(), setTimelineHorizon: vi.fn(), setCurrentTime: vi.fn(),
    setTimelineClipDrag: vi.fn(), commitVisualSegments: vi.fn(), notify: vi.fn(),
    pauseForTimelineEdit: vi.fn(), trimGestureRef: { current: null as null | (() => void) },
    currentTrimContext: { current: { visualSegments: clips, locked: false } },
  };
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frame = cb; return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { frame = undefined; });
  const tick = () => { const cb = frame; frame = undefined; cb?.(0); };
  const begin = (edge: 'start' | 'end') => createImageResizeControl(d)({
    button: 0, clientX: edge === 'start' ? 0 : 300, pointerType: 'mouse', preventDefault() {}, stopPropagation() {},
  }, 'v', 0, edge);
  const move = (x: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX: x }));
  return { d, begin, move, tick };
}

it('trims the leading source at constant speed, previewing without intermediate saved edits', () => {
  const h = harness(); h.begin('start'); h.move(50); h.tick();
  expect(h.d.setVisualSegments).not.toHaveBeenCalled();
  expect(h.d.commitVisualSegments).not.toHaveBeenCalled();
  expect(h.d.setTimelineClipDrag.mock.lastCall?.[0]?.previewSegments[0]).toMatchObject({ sourceStart: 6, duration: 5, playbackRate: 2 });
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 50 }));
  expect(h.d.commitVisualSegments).toHaveBeenCalledOnce();
  expect(h.d.commitVisualSegments.mock.lastCall?.[0][0]).toMatchObject({ sourceStart: 6, duration: 5, sourceDuration: 10, playbackRate: 2 });
  expect(h.d.commitVisualSegments.mock.lastCall?.[0][1]).toBe(h.d.visualSegments[1]);
});

it('coalesces pointer updates and commits the latest trailing edge on release', () => {
  const h = harness(); h.begin('end');
  for (let x = 200; x <= 250; x++) h.move(x);
  h.tick();
  expect(h.d.setTimelineClipDrag).toHaveBeenCalledTimes(1);
  h.move(200); window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200 }));
  expect(h.d.commitVisualSegments).toHaveBeenCalledOnce();
  expect(h.d.commitVisualSegments.mock.lastCall?.[0][0]).toMatchObject({ duration: 4, sourceDuration: 8, playbackRate: 2 });
});

it.each(['pointercancel', 'blur', 'escape'])('cancels %s without saving or accepting late events', cause => {
  const h = harness(); h.begin('start'); h.move(50); h.tick();
  window.dispatchEvent(cause === 'escape' ? new KeyboardEvent('keydown', { key: 'Escape' }) : new Event(cause));
  h.move(100); window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100 }));
  expect(h.d.commitVisualSegments).not.toHaveBeenCalled();
  expect(h.d.setVisualSegments).not.toHaveBeenCalled();
});

it('does not overwrite a changed document or a newly locked track on release', () => {
  const h = harness(); h.begin('end'); h.move(200); h.tick();
  h.d.currentTrimContext.current = { visualSegments: [...h.d.visualSegments], locked: true };
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200 }));
  expect(h.d.commitVisualSegments).not.toHaveBeenCalled();
});

it('keeps enough preview horizon to restore source beyond the current timeline end', () => {
  const h = harness();
  h.d.visualSegments[0]!.sourceMediaDuration = 80;
  h.begin('end'); h.move(1500); h.tick();
  const updateHorizon = h.d.setTimelineHorizon.mock.lastCall?.[0];
  expect(updateHorizon(20)).toBe(36);
  expect(h.d.setVisualSegments).not.toHaveBeenCalled();
  window.dispatchEvent(new MouseEvent('pointerup'));
  expect(h.d.commitVisualSegments.mock.lastCall?.[0][0]).toMatchObject({ duration: 30, playbackRate: 2 });
});

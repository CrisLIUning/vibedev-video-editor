// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cancelLatestVideoFrameRequest, requestLatestVideoFrame } from '../../../vendor/ai-video-editor/src/lib/videoFrameSync.js';

afterEach(() => vi.restoreAllMocks());
function harness(native = true) {
  const video = document.createElement('video');
  Object.defineProperty(video, 'seeking', { configurable: true, value: true });
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let id = 0;
  if (native) {
    video.requestVideoFrameCallback = vi.fn(callback => { callbacks.set(++id, callback); return id; });
    video.cancelVideoFrameCallback = vi.fn(handle => { callbacks.delete(handle); });
  }
  const add = vi.spyOn(video, 'addEventListener');
  const remove = vi.spyOn(video, 'removeEventListener');
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(10);
  const cancelRaf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  return { video, callbacks, add, remove, raf, cancelRaf };
}

it('does not restart an identical pending seek from every render, and calls the latest consumer', () => {
  const h = harness(); const first = vi.fn(), latest = vi.fn();
  requestLatestVideoFrame(h.video, 3, { immediate: true, onPresented: first });
  for (let i = 0; i < 20; i++) requestLatestVideoFrame(h.video, 3, { immediate: true, onPresented: latest });
  expect(h.video.requestVideoFrameCallback).toHaveBeenCalledOnce();
  Object.defineProperty(h.video, 'seeking', { value: false });
  h.callbacks.values().next().value!(0, { mediaTime: 3 } as VideoFrameCallbackMetadata);
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledExactlyOnceWith(3);
});

it('removes superseded and cancelled fallback seek listeners', () => {
  const h = harness(false), presented = vi.fn();
  requestLatestVideoFrame(h.video, 2, { immediate: true, onPresented: presented });
  requestLatestVideoFrame(h.video, 3, { immediate: true, onPresented: presented });
  cancelLatestVideoFrameRequest(h.video);
  const added = h.add.mock.calls.filter(([type]) => type === 'seeked').map(([, listener]) => listener);
  for (const listener of added) expect(h.remove).toHaveBeenCalledWith('seeked', listener);
  h.video.dispatchEvent(new Event('seeked'));
  expect(presented).not.toHaveBeenCalled();
});

it('cancels the fallback frame and cannot publish after disposal', () => {
  const h = harness(false), presented = vi.fn();
  Object.defineProperty(h.video, 'seeking', { value: false });
  requestLatestVideoFrame(h.video, 2, { immediate: true, onPresented: presented });
  const callback = h.raf.mock.lastCall?.[0];
  cancelLatestVideoFrameRequest(h.video);
  expect(h.cancelRaf).toHaveBeenCalledWith(10);
  callback?.(0); expect(presented).not.toHaveBeenCalled();
});

it('an already queued old callback cannot erase the new callback handle', () => {
  const h = harness(), presented = vi.fn();
  requestLatestVideoFrame(h.video, 1, { immediate: true, onPresented: presented });
  const obsolete = h.callbacks.get(1)!;
  requestLatestVideoFrame(h.video, 4, { immediate: true, onPresented: presented });
  obsolete(0, { mediaTime: 1 } as VideoFrameCallbackMetadata);
  cancelLatestVideoFrameRequest(h.video);
  expect(h.video.cancelVideoFrameCallback).toHaveBeenCalledWith(2);
  expect(presented).not.toHaveBeenCalled();
});

it('cannot seek a disposed element from an already queued RAF', () => {
  const h = harness();
  requestLatestVideoFrame(h.video, 5);
  const obsolete = h.raf.mock.lastCall?.[0];
  cancelLatestVideoFrameRequest(h.video);
  obsolete?.(0);
  expect(h.video.currentTime).toBe(0);
  expect(h.video.requestVideoFrameCallback).not.toHaveBeenCalled();
});

it('does not treat a playing element that has advanced as the same pending seek', () => {
  const h = harness();
  Object.defineProperty(h.video, 'seeking', { value: false });
  requestLatestVideoFrame(h.video, 2, { immediate: true });
  h.video.currentTime = 3;
  requestLatestVideoFrame(h.video, 2, { immediate: true });
  expect(h.video.currentTime).toBe(2);
  expect(h.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
});

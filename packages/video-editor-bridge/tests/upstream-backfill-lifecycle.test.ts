// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { React, createRoot, deferred } from './upstream-react-harness.js';
import { useHostVisualBackfill } from '../../../vendor/ai-video-editor/src/hooks/useHostVisualBackfill.js';
const { extractVideoTrackFrames, loadVideo } = vi.hoisted(() => ({ extractVideoTrackFrames: vi.fn(), loadVideo: vi.fn() }));

vi.mock('../../../vendor/ai-video-editor/src/lib/media.js', () => ({
  loadVideo, extractVideoTrackFrames,
  getVisualDimensions: () => ({ width: 1344, height: 768 }),
}));

type Clip = Record<string, unknown> & { id: string; src: string };
const clip = (id = 'clip', src = '/video.mp4'): Clip => ({ id, src, type: 'video', duration: 4,
  sourceDuration: 8, sourceStart: 2, playbackRate: 2, width: 0, height: 0 });
let unmount: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(loadVideo).mockResolvedValue({ duration: 20, removeAttribute() {}, load() {} });
  vi.mocked(extractVideoTrackFrames).mockReset();
});
afterEach(async () => { await React.act(() => unmount?.()); document.body.replaceChildren(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function mount(initial: Clip[]) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); unmount = () => root.unmount();
  let state: Clip[] = initial; let update!: (next: Clip[]) => void;
  function Harness() {
    const [segments, setSegments] = React.useState(initial); state = segments; update = setSegments;
    useHostVisualBackfill({ visualSegments: segments, setVisualSegments: setSegments });
    return null;
  }
  await React.act(() => root.render(React.createElement(Harness)));
  return { get: () => state, set: async (next: Clip[]) => React.act(() => update(next)) };
}

describe('video frame jobs survive timeline edits', () => {
  it('keeps decoded frames after an unrelated edit, without changing the authored trim or speed', async () => {
    const frames = deferred<string[]>(); vi.mocked(extractVideoTrackFrames).mockReturnValue(frames.promise);
    const h = await mount([clip()]);
    await h.set([{ ...h.get()[0]!, sourceAudioDisabled: true }]);
    await React.act(() => frames.resolve(['frame-1', 'frame-2']));
    expect(h.get()[0]).toMatchObject({ trackFrames: ['frame-1', 'frame-2'], width: 1344,
      sourceStart: 2, sourceDuration: 8, duration: 4, playbackRate: 2, sourceAudioDisabled: true });
    expect(extractVideoTrackFrames).toHaveBeenCalledTimes(1);
  });

  it('samples the full source so trimmed clips still map frames to source time', async () => {
    vi.mocked(extractVideoTrackFrames).mockResolvedValue(['full-source']);
    const h = await mount([clip()]);
    expect(extractVideoTrackFrames).toHaveBeenCalledWith('/video.mp4', expect.objectContaining({ duration: 20 }));
    expect(h.get()[0]?.trackFrameDuration).toBe(20);
  });

  it('reuses frames for a second clip and a document re-import of the same source', async () => {
    vi.mocked(extractVideoTrackFrames).mockResolvedValue(['cached']);
    const h = await mount([clip()]);
    await h.set([clip(), clip('second')]);
    expect(h.get().map(s => s.trackFrames)).toEqual([['cached'], ['cached']]);
    expect(extractVideoTrackFrames).toHaveBeenCalledTimes(1);
  });

  it('does not write an old decode into replacement media with the same clip id', async () => {
    const first = deferred<string[]>(), second = deferred<string[]>();
    vi.mocked(extractVideoTrackFrames).mockImplementation((src: string) => src === '/old.mp4' ? first.promise : second.promise);
    const retainedIdentity = { assetVersionId: 'v1', sourceUrl: '/old.mp4' };
    const h = await mount([{ ...clip('same', '/old.mp4'), ...retainedIdentity }]);
    await h.set([{ ...clip('same', '/new.mp4'), ...retainedIdentity }]);
    await React.act(() => first.resolve(['old']));
    expect(h.get()[0]?.trackFrames).toBeUndefined();
    await React.act(() => second.resolve(['new']));
    expect(h.get()[0]?.trackFrames).toEqual(['new']);
  });

  it('reuses versioned media when a document replaces its temporary blob with the canonical URL', async () => {
    vi.mocked(extractVideoTrackFrames).mockResolvedValue(['cached']);
    const identity = { assetVersionId: 'v1', sourceUrl: '/video.mp4' };
    const h = await mount([{ ...clip('clip', 'blob:download'), ...identity }]);
    await h.set([{ ...clip(), ...identity }]);
    expect(h.get()[0]?.trackFrames).toEqual(['cached']);
    expect(extractVideoTrackFrames).toHaveBeenCalledTimes(1);
  });

  it('bounds decoding to two sources and starts queued work after a source fails', async () => {
    const frames = deferred<string[]>();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(extractVideoTrackFrames).mockImplementation((src: string) => src === '/third.mp4' ? Promise.resolve(['third']) : frames.promise);
    try {
      const h = await mount([clip('1', '/one.mp4'), clip('2', '/two.mp4'), clip('3', '/third.mp4')]);
      expect(extractVideoTrackFrames).toHaveBeenCalledTimes(2);
      await React.act(() => frames.reject(new Error('decode failed')));
      expect(h.get()[2]?.trackFrames).toEqual(['third']);
      expect(extractVideoTrackFrames).toHaveBeenCalledTimes(3);
      await h.set([h.get()[2]!]);
      vi.mocked(extractVideoTrackFrames).mockResolvedValue(['retry']);
      await h.set([clip('1', '/one.mp4'), h.get()[0]!]);
      expect(h.get()[0]?.trackFrames).toEqual(['retry']);
    } finally { warning.mockRestore(); }
  });

  it('aborts pending media work on unmount', async () => {
    const pending = deferred<string[]>();
    vi.mocked(extractVideoTrackFrames).mockReturnValue(pending.promise);
    await mount([clip()]);
    const signal = vi.mocked(extractVideoTrackFrames).mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await React.act(() => unmount?.()); unmount = undefined;
    expect(signal.aborted).toBe(true);
    await React.act(() => pending.resolve(['late']));
  });
});

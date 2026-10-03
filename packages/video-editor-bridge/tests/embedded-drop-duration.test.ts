// @vitest-environment jsdom

// Field report (2026-09-02): a generated 6 s clip dragged from the project
// files onto the timeline was placed as 4 s. The daemon had measured the
// version (6.04 s) and the host returned it from pinProjectFile, but the
// editor copied only the identity off the pinned asset, kept the project
// file's placeholder duration of 0 and fell back to the image default.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAssetDropActions } from '../../../vendor/ai-video-editor/src/lib/assetDropActions.js';
import { mergeAuthorizedUserAssets } from '../../../vendor/ai-video-editor/src/lib/hostAuthorizedMedia.js';
import { clearRemoteAssetCache } from '../../../vendor/ai-video-editor/src/lib/remoteAssetCache.js';
import { createVisualTimelineActions } from '../../../vendor/ai-video-editor/src/lib/visualTimelineActions.js';

afterEach(() => { clearRemoteAssetCache(); vi.unstubAllGlobals(); });

const PINNED = {
  assetId: 'asset_d1eace4e',
  versionId: 'asset_version_22aea883',
  url: 'blob:vibedev/pinned-video',
};

function projectFileVideo() {
  return {
    id: 'file-seedance',
    type: 'video',
    src: '/api/projects/p1/files/video-seedance.mp4',
    sourceUrl: '/api/projects/p1/files/video-seedance.mp4',
    name: 'video-seedance.mp4',
    duration: 0,
    width: 0,
    height: 0,
    trackFrames: [],
    hostProjectFile: true,
    projectFileId: 'file-seedance',
    projectFilePath: 'video-seedance.mp4',
    requiresPin: true,
  };
}

function dropHarness(overrides: Record<string, unknown> = {}) {
  const appended: Array<Record<string, unknown>> = [];
  const d = {
    capabilityRuntime: {
      pinProjectFile: vi.fn(async () => ({ ...PINNED, durationSeconds: 6.041667 })),
    },
    canDropAssetOnTrack: () => true,
    notify: vi.fn(),
    setSelectedLibraryAssetId: vi.fn(),
    appendVisualAssetToTimeline: vi.fn((asset: Record<string, unknown>) => {
      appended.push(asset);
      return { id: 'segment-1', ...asset };
    }),
    onFirstVisualDropped: vi.fn(),
    onProjectFilePinned: vi.fn(),
    visualSegments: [],
    ...overrides,
  };
  return { d, appended, actions: createAssetDropActions(d) };
}

describe('placing a pinned project-file video', () => {
  it('removes only the failed download even when another clip was added in the meantime', async () => {
    let fail!: (error: Error) => void;
    const pending = new Promise<never>((_, reject) => { fail = reject; });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    const visualSegmentsRef = { current: [] as Array<Record<string, unknown>> };
    const clearImageTrack = vi.fn();
    const { actions } = dropHarness({ visualSegmentsRef, clearImageTrack,
      appendVisualAssetToTimeline: (asset: Record<string, unknown>) => {
        const segment = { ...asset, id: 'pending' }; visualSegmentsRef.current.push(segment); return segment;
      },
      setVisualSegments: (update: (items: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => {
        visualSegmentsRef.current = update(visualSegmentsRef.current);
      },
    });
    const done = actions.applyAssetToTrack({ ...projectFileVideo(), hostProjectFile: false, hostAuthorized: true, requiresPin: false, duration: 10.125 }, 'image');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    visualSegmentsRef.current.push({ id: 'other', duration: 6 });
    fail(new Error('offline')); await done;
    expect(visualSegmentsRef.current).toEqual([{ id: 'other', duration: 6 }]);
    expect(clearImageTrack).not.toHaveBeenCalled();
  });
  it('does not finalize a four-second clip when the duration probe fails', async () => {
    const { actions, appended, d } = dropHarness({
      capabilityRuntime: { pinProjectFile: vi.fn(async () => ({ ...PINNED })) },
      readVideoDuration: vi.fn(async () => undefined),
    });
    await actions.applyAssetToTrack(projectFileVideo(), 'image');
    expect(appended).toEqual([]);
    expect(d.notify).toHaveBeenCalledWith(expect.stringContaining('时长'));
  });

  it('waits for the real length before the first remote video enters the timeline', async () => {
    let finish!: (n: number) => void;
    let probeStarted!: () => void;
    const started = new Promise<void>(resolve => { probeStarted = resolve; });
    const duration = new Promise<number>(resolve => { finish = resolve; });
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:duration-test'; } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers(), blob: async () => new Blob(['video']) })));
    const { actions, appended } = dropHarness({
      readVideoDuration: () => { probeStarted(); return duration; },
      updateVisualAssetInTimeline: vi.fn(),
    });
    const pending = actions.applyAssetToTrack({ ...projectFileVideo(), hostProjectFile: false, hostAuthorized: true, requiresPin: false }, 'image');
    await started;
    try { expect(appended).toEqual([]); }
    finally { finish(10.125); await pending; }
    expect(appended).toHaveLength(1);
    expect(appended[0]?.duration).toBe(10.125);
  });
  it('adopts the duration the host measured while pinning', async () => {
    const { actions, appended } = dropHarness();
    await actions.applyAssetToTrack(projectFileVideo(), 'image');
    expect(appended).toHaveLength(1);
    expect(appended[0]?.assetVersionId).toBe(PINNED.versionId);
    expect(appended[0]?.duration).toBeCloseTo(6.041667, 5);
  });

  it('reads the duration off the media when the host could not measure it', async () => {
    const { actions, appended } = dropHarness({
      capabilityRuntime: { pinProjectFile: vi.fn(async () => ({ ...PINNED })) },
      readVideoDuration: vi.fn(async () => 6.04),
    });
    await actions.applyAssetToTrack(projectFileVideo(), 'image');
    expect(appended).toHaveLength(1);
    expect(appended[0]?.duration).toBeCloseTo(6.04, 5);
  });

  it('keeps a duration the editor already knows', async () => {
    const { actions, appended } = dropHarness();
    await actions.applyAssetToTrack({ ...projectFileVideo(), duration: 5.5 }, 'image');
    expect(appended[0]?.duration).toBe(5.5);
  });
});

describe('late video placement and metadata', () => {
  function timeline(initial: Array<Record<string, unknown>>) {
    let segments = initial;
    const ref = { current: segments };
    const noop = () => {};
    const actions = createVisualTimelineActions({ visualSegments: initial, visualSegmentsRef: ref,
      trackLocks: {}, script: '', imageSrc: '/stale.mp4',
      setVisualSegments(next: typeof segments | ((items: typeof segments) => typeof segments)) {
        segments = typeof next === 'function' ? next(segments) : next; ref.current = segments;
      },
      setFitMode: noop, setImageSrc: noop, setImageName: noop, setImageMeta: noop, setVisualType: noop,
      setImageDuration: noop, setImageClipCount: noop, setSelectedTrack: noop,
      setSelectedVisualSegmentId: noop, setCurrentTime: noop, notify: noop, seekTo: noop,
    });
    return { actions, ref, get: () => segments };
  }
  it('appends to the latest list, including two drops completed before a React render', () => {
    const h = timeline([]);
    h.ref.current = [{ id: 'already-added', duration: 3 }];
    h.actions.appendVisualAssetToTimeline({ id: 'video', type: 'video', src: '/video.mp4', duration: 10.125 });
    h.actions.appendVisualAssetToTimeline({ id: 'image', type: 'image', src: '/image.png', duration: 5 });
    expect(h.get().map(s => s.duration)).toEqual([3, 10.125, 5]);
  });
  it('does not resurrect a deleted clip when a pending drop finishes', () => {
    const h = timeline([{ id: 'deleted', duration: 4 }]); h.ref.current = [];
    h.actions.appendVisualAssetToTimeline({ id: 'video', type: 'video', duration: 10.125 });
    expect(h.get()).toHaveLength(1);
    expect(h.get()[0]?.duration).toBe(10.125);
  });
  it('keeps a pending video trim and speed when download metadata arrives', () => {
    const h = timeline([{ id: 'edited', assetId: 'video', type: 'video', preparing: true,
      duration: 3, sourceStart: 2, sourceDuration: 6, playbackRate: 2 }]);
    h.actions.updateVisualAssetInTimeline('video', { duration: 10.125, playbackRate: 1, preparing: false, src: 'blob:ready' });
    expect(h.get()[0]).toMatchObject({ preparing: false, duration: 3, sourceStart: 2, sourceDuration: 6, playbackRate: 2 });
  });
});

describe('merging host assets into the library', () => {
  it('fills a retained entry that has no duration from the authorized version', () => {
    const merged = mergeAuthorizedUserAssets(
      [{ ...projectFileVideo(), assetId: PINNED.assetId, assetVersionId: PINNED.versionId }],
      [{ assetId: PINNED.assetId, versionId: PINNED.versionId, kind: 'video', url: '/api/v1.mp4', durationSeconds: 6.04 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.duration).toBeCloseTo(6.04, 5);
    expect(String((merged[0] as Record<string, unknown> | undefined)?.meta)).toContain('6.0s');
  });

  it('does not override a duration the editor measured itself', () => {
    const merged = mergeAuthorizedUserAssets(
      [{ ...projectFileVideo(), assetId: PINNED.assetId, assetVersionId: PINNED.versionId, duration: 5.5 }],
      [{ assetId: PINNED.assetId, versionId: PINNED.versionId, kind: 'video', url: '/api/v1.mp4', durationSeconds: 6.04 }],
    );
    expect(merged[0]?.duration).toBe(5.5);
  });
});

import { describe, expect, it, vi } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import videoExportSource from '../../../vendor/ai-video-editor/src/hooks/useVideoExport.js?raw';
import { loadAuthorizedAudioSegmentMedia } from '../../../vendor/ai-video-editor/src/lib/hostAuthorizedMedia.js';

/**
 * The bytes behind a voice clip the host placed.
 *
 * A cut the film module builds gets its voices from the daemon, and the import
 * restores them as SOURCES — the editor plays each clip from its authorized
 * URL and never holds the file. The browser export mixes Blobs, so it refused
 * every such cut: "配音片段的音频媒体已丢失". The refusal is right about what it
 * sees and wrong about what to do, because the file is one authorized request
 * away. This covers the request — who is allowed to make it, when, and how
 * often — and pins the two places in the vendored source that reach it.
 */

const voiceAsset = {
  assetId: 'canvas-file:canvas/uploads/line-1.m4a',
  versionId: 'canvas-file:canvas/uploads/line-1.m4a',
  kind: 'audio',
  name: 'line-1.m4a',
  url: '/api/projects/film-demo/raw/canvas/uploads/line-1.m4a',
  mimeType: 'audio/mp4',
};

const hostVoiceClip = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  assetId: voiceAsset.assetId,
  assetVersionId: voiceAsset.versionId,
  sourceUrl: voiceAsset.url,
  url: voiceAsset.url,
  peaks: [] as number[],
  start: 0,
  duration: 2.7,
  ...overrides,
});

const respondWith = (blob: Blob) => vi.fn(
  async (_url: string, _init?: RequestInit) => new Response(blob, { status: 200 }),
);

describe('reading a host-placed voice clip for the export', () => {
  it('gives every clip its bytes, reading each AssetVersion once', async () => {
    const blob = new Blob(['voice'], { type: 'audio/mp4' });
    const fetchImpl = respondWith(blob);
    const progress: Array<{ current: number; total: number }> = [];

    // Two clips cut from one recording, plus one the person recorded here and
    // whose Blob the editor already holds.
    const local = { id: 'local', blob: new Blob(['local'], { type: 'audio/wav' }) };
    const segments = [hostVoiceClip('line-1'), hostVoiceClip('line-1-tail', { start: 3 }), local];

    const loaded = await loadAuthorizedAudioSegmentMedia(segments, [voiceAsset], {
      fetchImpl,
      onProgress: (step) => progress.push(step),
    });

    expect(loaded.map((segment) => segment.blob)).toEqual([blob, blob, local.blob]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(voiceAsset.url);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin' });
    expect(progress).toEqual([{ current: 1, total: 1 }]);
  });

  it('leaves the clips it came with alone, so the open cut is the cut it renders', async () => {
    const segments = [hostVoiceClip('line-1')];
    const loaded = await loadAuthorizedAudioSegmentMedia(segments, [voiceAsset], {
      fetchImpl: respondWith(new Blob(['voice'])),
    });

    // The export mixes copies. Writing the Blob into the editor's own segment
    // would make the next autosave a revision of a cut nobody edited.
    expect(loaded[0]).not.toBe(segments[0]);
    expect('blob' in segments[0]!).toBe(false);
    expect(loaded[0]).toMatchObject({ id: 'line-1', url: voiceAsset.url });
  });

  it('reads two versions of one recording as the two files they are', async () => {
    const retake = { ...voiceAsset, versionId: `${voiceAsset.versionId}#2`, url: '/api/projects/film-demo/raw/canvas/uploads/line-1-retake.m4a' };
    const fetched: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      fetched.push(url);
      return new Response(new Blob([url]), { status: 200 });
    });

    await loadAuthorizedAudioSegmentMedia(
      [hostVoiceClip('line-1'), hostVoiceClip('line-1-retake', { assetVersionId: retake.versionId, sourceUrl: retake.url, url: retake.url })],
      [voiceAsset, retake],
      { fetchImpl },
    );

    // A clip pinned to an older take must not be rendered with the newer one.
    expect(fetched).toEqual([voiceAsset.url, retake.url]);
  });

  it('asks for nothing when no clip is missing its media', async () => {
    const fetchImpl = vi.fn();
    const segments = [{ id: 'local', blob: new Blob(['local']) }, { id: 'silence' }];

    await expect(loadAuthorizedAudioSegmentMedia(segments, [voiceAsset], { fetchImpl }))
      .resolves.toBe(segments);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never requests a URL the host did not authorize', async () => {
    const fetchImpl = vi.fn();
    const forged = hostVoiceClip('forged', {
      assetId: undefined,
      assetVersionId: undefined,
      sourceUrl: 'https://example.com/private.wav',
    });

    const loaded = await loadAuthorizedAudioSegmentMedia([forged], [voiceAsset], { fetchImpl });

    // Refused, and refused quietly: the clip comes back without media and the
    // export's own rule about a voice without media is the one that speaks.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loaded[0]!.blob).toBeUndefined();
  });

  it('leaves a clip without media when its bytes will not come', async () => {
    const failing = vi.fn(async (_url: string, _init?: RequestInit) => new Response('', { status: 404 }));

    const loaded = await loadAuthorizedAudioSegmentMedia([hostVoiceClip('line-1')], [voiceAsset], {
      fetchImpl: failing,
    });

    expect(failing).toHaveBeenCalledTimes(1);
    expect(loaded[0]!.blob).toBeUndefined();
  });

  it('takes the audio out of a clip cut from a video AssetVersion', async () => {
    const shot = {
      assetId: 'canvas-file:canvas/uploads/shot.mp4',
      versionId: 'canvas-file:canvas/uploads/shot.mp4',
      kind: 'video',
      name: 'shot.mp4',
      url: '/api/projects/film-demo/raw/canvas/uploads/shot.mp4',
    };
    const file = new Blob(['video'], { type: 'video/mp4' });
    const track = new Blob(['wav'], { type: 'audio/wav' });
    const extractVideoAudio = vi.fn(async () => track);
    const clip = {
      id: 'linked-1',
      sourceKind: 'video',
      assetId: shot.assetId,
      assetVersionId: shot.versionId,
      sourceUrl: shot.url,
    };

    const loaded = await loadAuthorizedAudioSegmentMedia([clip], [shot], {
      fetchImpl: respondWith(file),
      extractVideoAudio,
    });

    expect(extractVideoAudio).toHaveBeenCalledWith(file, 'shot.mp4');
    expect(loaded[0]!.blob).toBe(track);

    // Without an extractor the clip is left alone rather than handed an MP4 to
    // decode as if it were a sound.
    const bare = await loadAuthorizedAudioSegmentMedia([clip], [shot], {
      fetchImpl: respondWith(file),
    });
    expect(bare[0]!.blob).toBeUndefined();
  });

  it('stops when the export is canceled', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      controller.abort();
      return new Response(new Blob(['voice']), { status: 200 });
    });

    await expect(loadAuthorizedAudioSegmentMedia(
      [hostVoiceClip('line-1')],
      [voiceAsset],
      { fetchImpl, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('the browser export, on a cut whose sound came from the host', () => {
  const hook = videoExportSource.slice(
    videoExportSource.indexOf('const laneVoiceSegments'),
    videoExportSource.indexOf('const exportOptions'),
  );

  it('reads the voice media before it decides the media is missing', () => {
    expect(hook).toContain('await loadAuthorizedAudioSegmentMedia(');
    expect(hook.indexOf('loadAuthorizedAudioSegmentMedia'))
      .toBeLessThan(hook.indexOf('配音片段的音频媒体已丢失'));
    // The refusal stays: a clip that is still without media after the read is
    // one no export can mix, and a silent video is worse than a refusal.
    expect(hook).toContain('!(segment.blob instanceof Blob)');
  });

  it('mixes the segments it read, not the ones it was given', () => {
    // `voiceAudioSegments` is the name the export options carry, so binding it
    // to the result is what puts the bytes in the mix.
    expect(hook).toMatch(/const voiceAudioSegments = await loadAuthorizedAudioSegmentMedia\(\s*laneVoiceSegments,/);
    expect(videoExportSource).toContain('voiceAudioSegments, voiceVolume: d.volume,');
  });

  it('reads the whole visible lane, not only the clips inside the range', () => {
    // The compatibility recorder decodes every clip it is handed and only then
    // drops the ones outside the export range; a blob-less clip there is a
    // crash, not a skip.
    expect(hook.indexOf('loadAuthorizedAudioSegmentMedia'))
      .toBeLessThan(hook.indexOf('const visibleVoiceSegments'));
  });

  it('says which file it is fetching while it fetches', () => {
    expect(hook).toContain('onProgress: ({ current, total }) => progress({');
    expect(hook).toContain('localize("exportVoiceMedia", { current, total }');
  });

  it('hands the hook the authorized list, and keeps that list as the host gave it', () => {
    const call = appSource.slice(
      appSource.indexOf('useVideoExport({'),
      appSource.indexOf('createTimelineReorderControls('),
    );
    expect(call).toContain('hostAuthorizedAssetsRef,');
    expect(appSource).toContain('hostAuthorizedAssetsRef.current = Array.isArray(assets) ? assets : [];');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRemoteAssetCache, getRemoteAssetBlob, isFetchableAssetSource } from '../../../vendor/ai-video-editor/src/lib/remoteAssetCache.js';

afterEach(() => { clearRemoteAssetCache(); vi.unstubAllGlobals(); });

describe('team assets without hover prefetch', () => {
  it('downloads the scoped identity directly through the preview/drop loader', async () => {
    const asset = { src: 'vibedev-team-media:ws_A/asset_7' };
    const fetchMock = vi.fn(async (url: string) => url.startsWith('/api/')
      ? new Response(JSON.stringify({ url: 'https://media.example.test/video.mp4' }))
      : new Response('real fixture media', { headers: { 'content-type': 'video/mp4' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(isFetchableAssetSource(asset)).toBe(true);
    const blob = await getRemoteAssetBlob(asset);
    expect(await blob?.text()).toBe('real fixture media');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/team/ws_A/media/asset_7/url');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://media.example.test/video.mp4');
  });
  it('does not retarget an old asset to the currently selected team', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRemoteAssetBlob({ src: 'vibedev-team-media:original-team/asset_7' })).rejects.toThrow('403');
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/team/original-team/media/asset_7/url']);
  });
  it('rejects malformed identities and unsafe URL schemes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'file:///private/nope' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRemoteAssetBlob({ src: 'vibedev-team-media:asset_without_workspace' })).rejects.toThrow('identity');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getRemoteAssetBlob({ src: 'vibedev-team-media:ws_A/asset_7' })).rejects.toThrow('URL unavailable');
  });
});

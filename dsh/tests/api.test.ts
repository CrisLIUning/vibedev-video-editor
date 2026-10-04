import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMaterial, importWorkspaceFile } from '../src/api.ts';

afterEach(() => { vi.unstubAllGlobals(); });

function answer(body: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

describe('workspace material', () => {
  it('asks the plugin to import a nested workspace file by its path, unchanged', async () => {
    const calls = answer({ file: { name: 'canvas/media/镜头 01.mp4', size: 3, mime: 'video/mp4' }, reused: false });
    const file = await importWorkspaceFile('素材/第一场/镜头 01.mp4');
    expect(file).toEqual({ name: 'canvas/media/镜头 01.mp4', size: 3, mime: 'video/mp4' });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url, 'http://host.test');
    expect(url.pathname).toBe('/api/dsh-film/studio-write');
    expect(url.searchParams.get('path')).toBe('/api/canvas/timelines/film-1/import?project=film-1');
    expect(url.searchParams.get('method')).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ path: '素材/第一场/镜头 01.mp4' });
  });

  it('passes on the plugin saying the listing was cut short', async () => {
    answer({ assets: [], projectFiles: [], truncated: true });
    expect(await getMaterial()).toEqual({ assets: [], projectFiles: [], truncated: true });
  });
});

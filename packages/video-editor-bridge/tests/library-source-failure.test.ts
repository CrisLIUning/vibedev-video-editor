import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import source from '../../../vendor/ai-video-editor/src/hooks/useEditorCatalog.js?raw';

// Execute the vendored hook with deterministic React/timer adapters. Requests
// and its real state transitions are tested without a browser or external API.
async function load(communityOk: boolean, externalOk: boolean, abort = false) {
  const states: unknown[] = [];
  let index = 0;
  let effect: (() => (() => void)) | undefined;
  let timer: (() => Promise<void>) | undefined;
  const module = { exports: {} as { useEditorCatalog: (filter: string) => unknown } };
  runInNewContext(transformSync(source, { format: 'cjs', define: { 'import.meta.env': '{}' } }).code, {
    module, exports: module.exports, URLSearchParams, AbortController,
    setTimeout: (callback: () => Promise<void>) => { timer = callback; return 1; },
    clearTimeout: () => {},
    require: (name: string) => name === 'react' ? {
      useState: (initial: unknown) => { const slot = index++; states[slot] = initial; return [initial, (value: unknown) => { states[slot] = value; }]; },
      useMemo: (fn: () => unknown) => fn(),
      useEffect: (fn: () => (() => void)) => { effect = fn; },
    } : name.includes('config/editor') ? { VOICES: [] } : name.includes('vectorAssets') ? { VECTOR_ASSETS: [] } : {},
    fetch: async (url: string) => {
      if (url.startsWith('/api/community/media')) return {
        ok: communityOk,
        json: async () => ({ items: [{ id: 7, kind: 'image', title: 'Shared image', downloadUrl: 'https://fixture.invalid/shared.png' }] }),
      };
      if (!externalOk) throw new Error('external unavailable');
      return { ok: true, json: async () => ({ results: [{ id: 'stock', url: 'https://fixture.invalid/stock.png' }] }) };
    },
  });
  module.exports.useEditorCatalog('');
  const cleanup = effect?.();
  if (abort) cleanup?.();
  if (!timer) throw new Error('Hook did not schedule a load');
  await timer();
  return states;
}

describe('library source failures', () => {
  it('keeps community media when the external source rejects', async () => {
    const states = await load(true, false);
    expect(states).toContain('ready');
    expect(states.find(value => Array.isArray(value) && value.some(item => item.id === 'community-7')))
      .toEqual([expect.objectContaining({ id: 'community-7', src: 'https://fixture.invalid/shared.png' })]);
  });
  it('keeps external media when community is unavailable', async () => {
    expect(await load(false, true)).toContain('ready');
  });
  it('reports an error when neither source supplies results', async () => {
    expect(await load(false, false)).toContain('error');
  });
  it('does not publish results from a cancelled query', async () => {
    expect(await load(true, true, true)).not.toContain('ready');
  });
});

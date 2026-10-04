import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

it('asks to reopen the tab when the workspace has no film yet, instead of pointing at a page DSH does not have', async () => {
  document.body.innerHTML = '<div id="editor"></div><div id="status"></div><div id="banner" hidden></div>';
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    if (url.startsWith('/api/dsh-film/project?')) return new Response(JSON.stringify({ project: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404 });
  }));
  // The page script runs on import.
  await import('../src/host.ts');
  const status = document.getElementById('status')!;
  await vi.waitFor(() => expect(status.textContent).toContain('重新打开'));
  expect(status.hidden).toBe(false);
  expect(status.textContent).not.toMatch(/开始/);
  expect(requested).toEqual(['/api/dsh-film/project?cwd=C%3A%5Cws']);
});

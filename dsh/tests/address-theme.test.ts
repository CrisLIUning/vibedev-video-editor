import { describe, expect, it } from 'vitest';

import { projectId, toHostUrl, workspace } from '../src/address.ts';
import { editorTheme, initialTheme, themeMessage } from '../src/theme.ts';

describe('the page address', () => {
  it('reads the workspace and the project from the page URL', () => {
    expect(workspace).toBe('C:\\ws');
    expect(projectId).toBe('film-1');
  });

  it('sends daemon reads and writes to the plugin\'s two routes', () => {
    const read = new URL(toHostUrl('/api/projects/film-1/raw/canvas/media/a%20b.png'), 'http://host.test');
    expect(read.pathname).toBe('/api/dsh-film/studio');
    expect(read.searchParams.get('cwd')).toBe('C:\\ws');
    expect(read.searchParams.get('path')).toBe('/api/projects/film-1/raw/canvas/media/a%20b.png');
    expect(read.searchParams.has('method')).toBe(false);
    const write = new URL(toHostUrl('/api/canvas/timelines/film-1?project=film-1', 'put'), 'http://host.test');
    expect(write.pathname).toBe('/api/dsh-film/studio-write');
    expect(write.searchParams.get('path')).toBe('/api/canvas/timelines/film-1?project=film-1');
    expect(write.searchParams.get('method')).toBe('PUT');
  });

  it('leaves the plugin\'s own routes, other origins and non-API paths alone', () => {
    expect(toHostUrl('/api/dsh-film/media?path=x')).toBe('/api/dsh-film/media?path=x');
    expect(toHostUrl('https://vibedev.jzsaas.com/video-editor-models/a')).toBe('https://vibedev.jzsaas.com/video-editor-models/a');
    expect(toHostUrl('/api/dsh-film/apps/editor/assets/a.js')).toBe('/api/dsh-film/apps/editor/assets/a.js');
    expect(toHostUrl('blob:http://host.test/1')).toBe('blob:http://host.test/1');
  });
});

describe('the host look', () => {
  it('maps the host tokens onto the editor variables', () => {
    const theme = editorTheme({
      scheme: 'dark',
      tokens: { '--dsw-alias-bg-base': '#101010', '--dsw-alias-brand-primary': 'rgb(77, 107, 254)', '--dsw-alias-label-primary': 'var(--x)' },
    });
    expect(theme['--vibedev-editor-color-scheme']).toBe('dark');
    expect(theme['--vibedev-editor-background']).toBe('#101010');
    expect(theme['--vibedev-editor-accent']).toBe('rgb(77, 107, 254)');
    // Not a plain colour: the warm fallback.
    expect(theme['--vibedev-editor-text']).toBe('#ecebe8');
    expect(editorTheme({ scheme: 'light' })['--vibedev-editor-surface']).toBe('#fdfcfa');
  });

  it('opens on the scheme in the URL and reads only the workbench\'s theme messages', () => {
    expect(initialTheme()).toEqual({ scheme: 'dark' });
    expect(themeMessage({ source: 'dsh-film', type: 'theme', theme: { scheme: 'light', tokens: { a: '#fff' } } })).toEqual({ scheme: 'light', tokens: { a: '#fff' } });
    expect(themeMessage({ source: 'other', type: 'theme', theme: { scheme: 'light' } })).toBeUndefined();
    expect(themeMessage({ source: 'dsh-film', type: 'theme', theme: { scheme: 'blue' } })).toBeUndefined();
    expect(themeMessage(null)).toBeUndefined();
  });
});

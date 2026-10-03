// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createEditorSurface } from '../src/index.js';

describe('embedded editor surface lifecycle', () => {
  it('keeps upstream styles and language inside a shadow surface', () => {
    document.documentElement.lang = 'en';
    const container = document.createElement('div');
    document.body.append(container);

    const surface = createEditorSurface(container, {
      css: ':host { color: white } .app-shell { height: 100% }',
      locale: 'zh-CN',
      theme: { '--od-accent': '#6d5dfc', color: 'red' },
    });

    expect(container.dataset.vibedevVideoEditorRoot).toBe('true');
    expect(container.style.getPropertyValue('--od-accent')).toBe('#6d5dfc');
    expect(container.style.getPropertyValue('color')).toBe('');
    expect(surface.shadowRoot.querySelector('style')?.textContent).toContain('.app-shell');
    expect(surface.mountPoint.lang).toBe('zh-CN');
    expect(surface.overlayRoot.dataset.videoEditorOverlayRoot).toBe('true');
    expect(document.head.querySelector('style')).toBeNull();
    expect(document.documentElement.lang).toBe('en');

    surface.dispose();
    expect(container.dataset.vibedevVideoEditorRoot).toBeUndefined();
    expect(container.style.getPropertyValue('--od-accent')).toBe('');
    expect(surface.shadowRoot.childNodes).toHaveLength(0);
  });

  it('pauses editor-owned media exactly once during idempotent disposal', () => {
    const container = document.createElement('div');
    const surface = createEditorSurface(container, { css: '', locale: 'en', theme: {} });
    const media = document.createElement('video');
    const pause = vi.fn();
    Object.defineProperty(media, 'pause', { value: pause });
    surface.mountPoint.append(media);

    surface.dispose();
    surface.dispose();

    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('rejects mounting over an existing shadow root', () => {
    const container = document.createElement('div');
    container.attachShadow({ mode: 'open' });

    expect(() => createEditorSurface(container, { css: '', locale: 'en', theme: {} })).toThrowError(
      expect.objectContaining({ code: 'EDITOR_ALREADY_MOUNTED' }),
    );
  });
});

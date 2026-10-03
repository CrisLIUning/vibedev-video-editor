// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  createEditorSurface,
  registerEditorHostEnvironment,
  resolveEmbeddedEditorPortalTarget,
  setEmbeddedEditorLanguage,
} from '../src/index.js';

let disposeEnvironment: (() => void) | undefined;

afterEach(() => {
  disposeEnvironment?.();
  disposeEnvironment = undefined;
});

describe('editor host environment', () => {
  it('routes portals and language into the active shadow surface', () => {
    const surface = createEditorSurface(document.createElement('div'), {
      css: '',
      locale: 'en',
      theme: {},
    });
    disposeEnvironment = registerEditorHostEnvironment(surface);

    expect(resolveEmbeddedEditorPortalTarget(document.body)).toBe(surface.overlayRoot);
    setEmbeddedEditorLanguage('zh-CN');
    expect(surface.mountPoint.lang).toBe('zh-CN');
    expect(surface.overlayRoot.lang).toBe('zh-CN');
    expect(document.documentElement.lang).not.toBe('zh-CN');
  });

  it('falls back to the caller target outside an embedded mount', () => {
    expect(resolveEmbeddedEditorPortalTarget(document.body)).toBe(document.body);
  });

  it('rejects a second active embedded environment', () => {
    const first = createEditorSurface(document.createElement('div'), { css: '', locale: 'en', theme: {} });
    const second = createEditorSurface(document.createElement('div'), { css: '', locale: 'en', theme: {} });
    disposeEnvironment = registerEditorHostEnvironment(first);

    expect(() => registerEditorHostEnvironment(second)).toThrowError(
      expect.objectContaining({ code: 'EDITOR_ALREADY_MOUNTED' }),
    );
  });
});

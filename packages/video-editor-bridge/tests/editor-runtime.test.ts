// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  createVideoEditorRuntime,
  prepareEmbeddedEditorCss,
  type VideoEditorHostEvent,
  type VideoEditorHostOptions,
} from '../src/index.js';

function options(events: VideoEditorHostEvent[]): VideoEditorHostOptions {
  return {
    hostId: 'editor',
    locale: 'zh-CN',
    theme: {},
    document: {
      schemaVersion: 1,
      projectId: 'project',
      productionId: 'production',
      compositeId: 'composite',
      revision: 7,
      documentVersionId: 'version-7',
      upstreamDocument: {},
      assets: [],
    },
    onEvent: (event) => events.push(event),
  };
}

describe('video editor runtime', () => {
  it('rewrites only document-level upstream CSS and adds embedded sizing', () => {
    const css = prepareEmbeddedEditorCss(':root { color: white; } body { margin: 0; } .body-copy { color: red; height: 40vh; } @media (min-width: 761px) and (max-width: 1279px) { .app-shell { display: grid; } }');
    expect(css).toContain(':host { color: white; }');
    expect(css).toContain('[data-video-editor-body] { margin: 0; }');
    expect(css).toContain('.body-copy { color: red;');
    expect(css).toContain('.app-shell');
    expect(css).toContain('width: 100%');
    expect(css).toContain('color-scheme: var(--vibedev-editor-color-scheme, light)');
    expect(css).toContain('background: var(--vibedev-editor-background, #090b0f) !important');
    expect(css).toContain('var(--vibedev-editor-accent, #35ead9)');
    expect(css).toContain('@container vibedev-editor (min-width: 761px) and (max-width: 1279px)');
    expect(css).not.toContain('@media (min-width: 761px) and (max-width: 1279px)');
    expect(css).toContain('container-name: vibedev-editor');
    expect(css).toMatch(/\[data-video-editor-body\][\s\S]*container-name: vibedev-editor/);
    expect(css).not.toContain('background-color: var(--vibedev-editor-accent, #35ead9)');
    expect(css).toContain('height: 40cqh');
  });

  it('maps the upstream teal accent to the live VibeDev accent token', () => {
    const css = prepareEmbeddedEditorCss('.active { color: #35ead9; border-color: rgba(53,234,217,.4); accent-color: #66ddce; }');
    expect(css).toContain('color: var(--vibedev-editor-accent, #35ead9)');
    expect(css).toContain('color-mix(in srgb, var(--vibedev-editor-accent, #35ead9) 40%, transparent)');
    expect(css).toContain('accent-color: var(--vibedev-editor-accent, #35ead9)');
  });

  it('maps the upstream shell palette to VibeDev surface and text tokens', () => {
    const css = prepareEmbeddedEditorCss('.shell { background: #07090d; color: #eef5f7; border-color: rgba(255,255,255,.08); } .panel { background: #111820; color: #7f8d97; }');
    expect(css).toContain('background: var(--vibedev-editor-background, #07090d)');
    expect(css).toContain('color: var(--vibedev-editor-text, #eef5f7)');
    expect(css).toContain('border-color: var(--vibedev-editor-border, rgba(255,255,255,.08))');
    expect(css).toContain('background: var(--vibedev-editor-surface, #111820)');
    expect(css).toContain('color: var(--vibedev-editor-text-muted, #7f8d97)');
  });

  it('maps long-tail neutral editor colors instead of leaving dark islands in light mode', () => {
    const css = prepareEmbeddedEditorCss(
      '.card { background:#061515; color:#dffffb; border-color:#718089; box-shadow:inset 0 0 10px rgba(8,12,16,.72); }',
    );
    expect(css).toContain('background:var(--vibedev-editor-surface');
    expect(css).toContain('color:var(--vibedev-editor-text');
    expect(css).toContain('border-color:var(--vibedev-editor-text-muted');
    expect(css).toContain('color-mix(in srgb, var(--vibedev-editor-surface');
    expect(css).not.toContain('background:#061515');
  });

  it('uses the host theme for the complete editor surface instead of forcing dark mode', () => {
    const css = prepareEmbeddedEditorCss(':root { color-scheme: dark; background: #07090d; }');
    expect(css).toContain('color-scheme: var(--vibedev-editor-color-scheme, light)');
    expect(css).not.toContain('color-scheme: var(--vibedev-editor-color-scheme, dark)');
  });

  it('gives floating editor surfaces an opaque host-themed background', () => {
    const css = prepareEmbeddedEditorCss('.transition-popover { background: rgba(19, 25, 32, .98); }');
    expect(css).toContain('.transition-popover, .timeline-context-menu, .timeline-selection-menu, .popover');
    expect(css).toContain('.timeline-selection-menu');
    expect(css).toContain('background: var(--vibedev-editor-elevated, #fffefc) !important');
  });

  it('duplicates minified viewport media rules as embedded container rules', () => {
    const css = prepareEmbeddedEditorCss('@media(min-width:761px) and (max-width:1279px){.editor-grid{grid-template-columns:64px 1fr 0}}');
    expect(css).toContain('@container vibedev-editor (min-width:761px) and (max-width:1279px)');
    expect(css).not.toContain('@media(min-width:761px) and (max-width:1279px)');
    expect(css).toContain('.editor-grid{grid-template-columns:64px 1fr 0}');
  });

  it('keeps device capabilities outside while evaluating width against the editor container', () => {
    const css = prepareEmbeddedEditorCss('@media (min-width: 761px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: reduce) {.desktop-control{display:block}}');
    expect(css).toContain('@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: reduce)');
    expect(css).toContain('@container vibedev-editor (min-width: 761px)');
    expect(css).not.toContain('@media (min-width: 761px)');
    expect(css).toContain('.desktop-control{display:block}');
  });

  it('mounts the renderer, forwards updates and disposes renderer before the surface', () => {
    const events: VideoEditorHostEvent[] = [];
    const updateDocument = vi.fn();
    const resolveCommand = vi.fn();
    const unmount = vi.fn();
    const render = vi.fn((surface) => {
      surface.mountPoint.textContent = 'editor mounted';
      return { updateDocument, resolveCommand, unmount };
    });
    const runtime = createVideoEditorRuntime({ css: ':root {}', render });
    const container = document.createElement('div');

    const mounted = runtime.mountVideoEditor(container, options(events));
    expect(container.shadowRoot?.textContent).toContain('editor mounted');
    expect(events).toEqual([{ type: 'ready', revision: 7 }]);

    mounted.updateDocument({ ...options([]).document, revision: 8, documentVersionId: 'version-8' });
    mounted.resolveCommand({
      ok: true,
      operationId: 'operation',
      revision: 8,
      documentVersionId: 'version-8',
      diff: {},
    });
    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(resolveCommand).toHaveBeenCalledTimes(1);

    mounted.unmount();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(container.shadowRoot?.childNodes).toHaveLength(0);
  });

  it('cleans the shadow surface when the renderer throws', () => {
    const runtime = createVideoEditorRuntime({
      css: '',
      render: () => {
        throw new Error('render failed');
      },
    });
    const container = document.createElement('div');

    expect(() => runtime.mountVideoEditor(container, options([]))).toThrow('render failed');
    expect(container.shadowRoot?.childNodes).toHaveLength(0);
    expect(container.dataset.vibedevVideoEditorRoot).toBeUndefined();
  });
});

describe('host notices', () => {
  it('forwards a notice to the rendered editor, and to nowhere when the editor has no toast', () => {
    const notify = vi.fn();
    const runtime = createVideoEditorRuntime({
      css: '',
      render: () => ({ updateDocument: vi.fn(), resolveCommand: vi.fn(), notify, unmount: vi.fn() }),
    });
    const mounted = runtime.mountVideoEditor(document.createElement('div'), options([]));
    mounted.notify?.({ message: '渲染中 50%' });
    expect(notify).toHaveBeenCalledWith({ message: '渲染中 50%' });
    mounted.unmount();

    const silent = createVideoEditorRuntime({
      css: '',
      render: () => ({ updateDocument: vi.fn(), resolveCommand: vi.fn(), unmount: vi.fn() }),
    }).mountVideoEditor(document.createElement('div'), options([]));
    expect(() => silent.notify?.({ message: 'nobody listening' })).not.toThrow();
    silent.unmount();
  });

  it('forwards whatever the rendered editor offers, including a method this layer never heard of', () => {
    // The wrapper used to hand-list the methods, so each new one had to be
    // remembered here too — and one was not.
    const playheadSeconds = vi.fn(() => 4.25);
    const mounted = createVideoEditorRuntime({
      css: '',
      render: () => ({ updateDocument: vi.fn(), resolveCommand: vi.fn(), playheadSeconds, unmount: vi.fn() } as never),
    }).mountVideoEditor(document.createElement('div'), options([]));
    expect((mounted as unknown as { playheadSeconds?: () => number }).playheadSeconds?.()).toBe(4.25);
    mounted.unmount();
  });

  it('forwards a caption to the rendered editor\'s voice, and answers missing when the editor has none', async () => {
    // Field report (2026-09-07, 剪五期): the host asked for every caption and
    // got `missing` each time — the wrapper below forwarded the toast but not
    // the voice, and the mount manager filled the gap with its default.
    const generateVoiceover = vi.fn(async (captionId: string) => ({ status: 'done' as const, message: captionId }));
    const mounted = createVideoEditorRuntime({
      css: '',
      render: () => ({ updateDocument: vi.fn(), resolveCommand: vi.fn(), generateVoiceover, unmount: vi.fn() }),
    }).mountVideoEditor(document.createElement('div'), options([]));
    await expect(mounted.generateVoiceover?.('cap-1')).resolves.toEqual({ status: 'done', message: 'cap-1' });
    expect(generateVoiceover).toHaveBeenCalledWith('cap-1');
    mounted.unmount();

    const mute = createVideoEditorRuntime({
      css: '',
      render: () => ({ updateDocument: vi.fn(), resolveCommand: vi.fn(), unmount: vi.fn() }),
    }).mountVideoEditor(document.createElement('div'), options([]));
    await expect(mute.generateVoiceover?.('cap-1')).resolves.toEqual({ status: 'missing' });
    mute.unmount();
  });
});

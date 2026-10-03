import { createEditorSurface, type EditorSurface } from './editor-lifecycle.js';
import {
  createVideoEditorMountManager,
  type VideoEditorVoiceOutcome,
  type MountedVideoEditor,
  type VideoEditorCommandResult,
  type VideoEditorDocumentEnvelope,
  type VideoEditorHostNotice,
  type VideoEditorHostOptions,
} from './host-contract.js';

const EMBEDDED_LAYOUT_CSS = `
:host {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  contain: layout paint style;
  color-scheme: var(--vibedev-editor-color-scheme, light);
  color: var(--vibedev-editor-text, #eef5f7);
  background: var(--vibedev-editor-background, #07090d);
}
:host-context(html[data-theme="dark"]) {
  --vibedev-editor-color-scheme: dark;
}
:host-context(html[data-theme="light"]) {
  --vibedev-editor-color-scheme: light;
}
[data-video-editor-body] {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  container-name: vibedev-editor;
  container-type: size;
}
.app-shell {
  width: 100%;
  height: 100%;
  min-width: 0;
  color: var(--vibedev-editor-text, #eef5f7);
  background: var(--vibedev-editor-background, #090b0f) !important;
}
[data-video-editor-body] {
  color: var(--vibedev-editor-text, #eef5f7);
  background: var(--vibedev-editor-background, #07090d);
}
.topbar {
  color: var(--vibedev-editor-text, #eef5f7);
  border-color: var(--vibedev-editor-border, rgba(255,255,255,.08)) !important;
  background: var(--vibedev-editor-surface, #0e1117) !important;
}
[class*="panel"], [class*="dialog"], [class*="workspace"], [class*="inspector"] {
  border-color: var(--vibedev-editor-border, rgba(255,255,255,.08));
  background-color: var(--vibedev-editor-surface, #111820);
  color: var(--vibedev-editor-text, #eef5f7);
}
.transition-popover, .timeline-context-menu, .timeline-selection-menu, .popover {
  color: var(--vibedev-editor-text, #1a1916) !important;
  border-color: var(--vibedev-editor-border, #e1e5eb) !important;
  background: var(--vibedev-editor-elevated, #fffefc) !important;
  box-shadow: 0 14px 36px rgba(0, 0, 0, .24) !important;
}
button:focus-visible, [role="button"]:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline-color: var(--vibedev-editor-accent, #35ead9);
}
[data-video-editor-overlay-root] {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
}
[data-video-editor-overlay-root] > * {
  pointer-events: auto;
}
`;

function semanticHexColor(value: string): string | null {
  const normalized = value.toLowerCase();
  const match = /^#([0-9a-f]{6})$/.exec(normalized);
  if (!match) return null;
  const encoded = match[1]!;
  const red = Number.parseInt(encoded.slice(0, 2), 16);
  const green = Number.parseInt(encoded.slice(2, 4), 16);
  const blue = Number.parseInt(encoded.slice(4, 6), 16);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;

  // The upstream skin has dozens of nearly-identical charcoal/teal-charcoal
  // literals. Keeping even one makes a black island in VibeDev light mode.
  // Preserve true black (shadows) and semantic red/blue/yellow colors, but map
  // every very-dark surface literal onto the host surface scale.
  if (maximum > 0 && maximum <= 12) {
    return `var(--vibedev-editor-background, ${normalized})`;
  }
  if (maximum <= 28) {
    return `var(--vibedev-editor-surface, ${normalized})`;
  }
  if (maximum <= 52 && red <= 44) {
    return `var(--vibedev-editor-elevated, ${normalized})`;
  }

  // Neutral and gently teal-tinted type colors are part of the editor chrome;
  // more saturated hues remain semantic media/effect colors.
  if (minimum >= 190 && saturation <= 0.22) {
    return `var(--vibedev-editor-text, ${normalized})`;
  }
  if (minimum >= 85 && maximum <= 190 && saturation <= 0.24) {
    return `var(--vibedev-editor-text-muted, ${normalized})`;
  }
  return null;
}

function themeUpstreamAccent(source: string): string {
  const containerSized = source
    .replace(/(-?(?:\d+\.?\d*|\.\d+))d?vh\b/gi, '$1cqh')
    .replace(/(-?(?:\d+\.?\d*|\.\d+))vw\b/gi, '$1cqw');
  const palette = new Map<string, string>([
    ['#07090d', 'var(--vibedev-editor-background, #07090d)'],
    ['#080a0e', 'var(--vibedev-editor-background, #080a0e)'],
    ['#090b0f', 'var(--vibedev-editor-background, #090b0f)'],
    ['#0e1117', 'var(--vibedev-editor-surface, #0e1117)'],
    ['#111820', 'var(--vibedev-editor-surface, #111820)'],
    ['#11151b', 'var(--vibedev-editor-surface, #11151b)'],
    ['#11161d', 'var(--vibedev-editor-surface, #11161d)'],
    ['#121820', 'var(--vibedev-editor-surface, #121820)'],
    ['#10151b', 'var(--vibedev-editor-surface-muted, #10151b)'],
    ['#10141a', 'var(--vibedev-editor-surface-muted, #10141a)'],
    ['#10161c', 'var(--vibedev-editor-surface-muted, #10161c)'],
    ['#171b22', 'var(--vibedev-editor-elevated, #171b22)'],
    ['#171d25', 'var(--vibedev-editor-elevated, #171d25)'],
    ['#1b2028', 'var(--vibedev-editor-elevated, #1b2028)'],
    ['#1c232c', 'var(--vibedev-editor-elevated, #1c232c)'],
    ['#20252d', 'var(--vibedev-editor-elevated, #20252d)'],
    ['#222831', 'var(--vibedev-editor-elevated, #222831)'],
    ['#242629', 'var(--vibedev-editor-elevated, #242629)'],
    ['#eef5f7', 'var(--vibedev-editor-text, #eef5f7)'],
    ['#eef5f6', 'var(--vibedev-editor-text, #eef5f6)'],
    ['#e9f2f4', 'var(--vibedev-editor-text, #e9f2f4)'],
    ['#eafcff', 'var(--vibedev-editor-text, #eafcff)'],
    ['#edf7f8', 'var(--vibedev-editor-text, #edf7f8)'],
    ['#eef7f7', 'var(--vibedev-editor-text, #eef7f7)'],
    ['#f0f7f8', 'var(--vibedev-editor-text, #f0f7f8)'],
    ['#f1f8fa', 'var(--vibedev-editor-text, #f1f8fa)'],
    ['#f4fbff', 'var(--vibedev-editor-text, #f4fbff)'],
    ['#dce7ea', 'var(--vibedev-editor-text, #dce7ea)'],
    ['#dce8eb', 'var(--vibedev-editor-text, #dce8eb)'],
    ['#dce8ee', 'var(--vibedev-editor-text, #dce8ee)'],
    ['#e2edf1', 'var(--vibedev-editor-text, #e2edf1)'],
    ['#e4edef', 'var(--vibedev-editor-text, #e4edef)'],
    ['#e6eef0', 'var(--vibedev-editor-text, #e6eef0)'],
    ['#7f8d97', 'var(--vibedev-editor-text-muted, #7f8d97)'],
    ['#7f8a95', 'var(--vibedev-editor-text-muted, #7f8a95)'],
    ['#7f8b96', 'var(--vibedev-editor-text-muted, #7f8b96)'],
    ['#82919b', 'var(--vibedev-editor-text-muted, #82919b)'],
    ['#84929d', 'var(--vibedev-editor-text-muted, #84929d)'],
    ['#8e9aa5', 'var(--vibedev-editor-text-muted, #8e9aa5)'],
    ['#93a1ab', 'var(--vibedev-editor-text-muted, #93a1ab)'],
    ['#98a3ad', 'var(--vibedev-editor-text-muted, #98a3ad)'],
    ['#9aa6af', 'var(--vibedev-editor-text-muted, #9aa6af)'],
    ['#9aa8b8', 'var(--vibedev-editor-text-muted, #9aa8b8)'],
    ['#aeb8c2', 'var(--vibedev-editor-text-muted, #aeb8c2)'],
    ['#aebbc3', 'var(--vibedev-editor-text-muted, #aebbc3)'],
    ['#35ead9', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#35e9d6', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#45e8d8', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#45f5e4', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#26cfc0', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#66ddce', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#42eadb', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#55eadc', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#57e8d8', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#29d9c8', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#20d2bf', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#2ce6d4', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#2ee9d9', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#31ead7', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#33e6d3', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#33e8d6', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#33ead8', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#34ead8', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#36dace', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#37e8d8', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#38e4d6', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#3eebda', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#43f3df', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#49f4df', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#4af0dc', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#5ef0e2', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#69f2e5', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#70ded3', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#74f3e7', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#7affef', 'var(--vibedev-editor-accent, #35ead9)'],
    ['#83fff3', 'var(--vibedev-editor-accent, #35ead9)'],
  ]);
  const themedHex = containerSized.replace(
    /#[0-9a-f]{6}/gi,
    (value) => palette.get(value.toLowerCase()) ?? semanticHexColor(value) ?? value,
  );
  const themedBorders = themedHex.replace(
    /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(?:0?\.08|0\.080)\s*\)/gi,
    'var(--vibedev-editor-border, rgba(255,255,255,.08))',
  );
  const themedTranslucentText = themedBorders.replace(
    /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(0?(?:\.\d+)|1(?:\.0+)?)\s*\)/gi,
    (_match, alpha: string) => {
      const percent = Math.round(Number(alpha) * 10000) / 100;
      return `color-mix(in srgb, var(--vibedev-editor-text, #eef5f7) ${percent}%, transparent)`;
    },
  );
  const themedTranslucentSurfaces = themedTranslucentText.replace(
    /rgba\(\s*(?:14\s*,\s*17\s*,\s*23|17\s*,\s*21\s*,\s*27|17\s*,\s*22\s*,\s*29|17\s*,\s*27\s*,\s*33|20\s*,\s*27\s*,\s*32)\s*,\s*(0?(?:\.\d+)|1(?:\.0+)?)\s*\)/gi,
    (_match, alpha: string) => {
      const percent = Math.round(Number(alpha) * 10000) / 100;
      return `color-mix(in srgb, var(--vibedev-editor-elevated, #171b22) ${percent}%, transparent)`;
    },
  );
  const themedLongTailSurfaces = themedTranslucentSurfaces.replace(
    /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0?(?:\.\d+)|1(?:\.0+)?)\s*\)/gi,
    (match, redText: string, greenText: string, blueText: string, alpha: string) => {
      const red = Number(redText);
      const green = Number(greenText);
      const blue = Number(blueText);
      const maximum = Math.max(red, green, blue);
      if (maximum === 0 || maximum > 52 || red > 44) return match;
      const percent = Math.round(Number(alpha) * 10000) / 100;
      return `color-mix(in srgb, var(--vibedev-editor-surface, rgb(${red},${green},${blue})) ${percent}%, transparent)`;
    },
  );
  const themedScheme = themedLongTailSurfaces.replace(
    /color-scheme\s*:\s*dark/gi,
    'color-scheme: var(--vibedev-editor-color-scheme, light)',
  );
  return themedScheme.replace(
    /rgba\(\s*(?:53\s*,\s*234\s*,\s*217|46\s*,\s*234\s*,\s*216|69\s*,\s*245\s*,\s*228|49\s*,\s*239\s*,\s*217|38\s*,\s*221\s*,\s*202|48\s*,\s*240\s*,\s*219)\s*,\s*(0?(?:\.\d+)|1(?:\.0+)?)\s*\)/gi,
    (_match, alpha: string) => {
      const percent = Math.round(Number(alpha) * 10000) / 100;
      return `color-mix(in srgb, var(--vibedev-editor-accent, #35ead9) ${percent}%, transparent)`;
    },
  );
}

function containerWidthQueries(source: string): string {
  let output = '';
  let copiedThrough = 0;
  // Vite minifies upstream CSS to `@media(...)` before it reaches this
  // runtime. Accept both minified and authored whitespace forms.
  const header = /@media\s*([^{}]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(source))) {
    const condition = match[1]?.trim() ?? '';
    if (!/(?:min|max)-width\s*:/i.test(condition)) continue;
    // Width belongs to the embedded editor, while pointer/hover/reduced-motion
    // still describe the real device or user preference. Keep those clauses in
    // an outer media query and evaluate only the width clauses in the named
    // editor container.
    if (condition.includes(',')) continue;
    const clauses = condition.split(/\s+and\s+/i).map((clause) => clause.trim()).filter(Boolean);
    const widthClauses = clauses.filter((clause) => /\((?:min|max)-width\s*:/i.test(clause));
    if (widthClauses.length === 0) continue;
    const mediaClauses = clauses.filter((clause) => !/\((?:min|max)-width\s*:/i.test(clause));
    const openBrace = header.lastIndex - 1;
    let depth = 1;
    let cursor = openBrace + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) continue;
    const body = source.slice(openBrace + 1, cursor - 1);
    const containerRule = `@container vibedev-editor ${widthClauses.join(' and ')} {${body}}`;
    output += source.slice(copiedThrough, match.index);
    output += mediaClauses.length > 0
      ? `@media ${mediaClauses.join(' and ')} {${containerRule}}`
      : containerRule;
    copiedThrough = cursor;
    header.lastIndex = cursor;
  }
  return copiedThrough > 0 ? output + source.slice(copiedThrough) : source;
}

/** Shadow DOM already scopes ordinary selectors. Only document-level rules
 * need a structural target inside the embedded surface. */
export function prepareEmbeddedEditorCss(source: string): string {
  const themed = themeUpstreamAccent(source);
  const scoped = themed
    .replace(/(^|})\s*:root\s*\{/gm, '$1\n:host {')
    .replace(/(^|})\s*body\s*\{/gm, '$1\n[data-video-editor-body] {');
  return `${containerWidthQueries(scoped)}\n${EMBEDDED_LAYOUT_CSS}`;
}

export interface RenderedVideoEditor {
  updateDocument(document: VideoEditorDocumentEnvelope): void;
  resolveCommand(result: VideoEditorCommandResult): void;
  notify?(notice: VideoEditorHostNotice): void;
  /** Speak a caption with the editor's selected voice; `missing` when the editor has no such caption. */
  generateVoiceover?(captionId: string): Promise<VideoEditorVoiceOutcome>;
  unmount(): void;
}

export type VideoEditorRenderImplementation = (
  surface: EditorSurface,
  options: VideoEditorHostOptions,
) => RenderedVideoEditor;

export interface VideoEditorRuntimeOptions {
  css: string;
  render: VideoEditorRenderImplementation;
}

export interface VideoEditorRuntimeModule {
  mountVideoEditor(container: HTMLElement, options: VideoEditorHostOptions): MountedVideoEditor;
}

export function createVideoEditorRuntime(
  runtimeOptions: VideoEditorRuntimeOptions,
): VideoEditorRuntimeModule {
  const manager = createVideoEditorMountManager((container, options) => {
    const surface = createEditorSurface(container, {
      css: prepareEmbeddedEditorCss(runtimeOptions.css),
      locale: options.locale,
      theme: options.theme,
    });
    let rendered: RenderedVideoEditor;
    try {
      rendered = runtimeOptions.render(surface, options);
      options.onEvent({ type: 'ready', revision: options.document.revision });
    } catch (error) {
      surface.dispose();
      throw error;
    }
    // Everything the rendered editor offers is forwarded as it is; only
    // `unmount` is this layer's own, because the surface has to go with it.
    // Hand-listing the methods here is what once dropped `generateVoiceover`
    // on the floor: the mount manager filled the gap with its default and the
    // host was told, every time, that the editor had no such caption.
    return {
      ...rendered,
      unmount() {
        try {
          rendered.unmount();
        } finally {
          surface.dispose();
        }
      },
    };
  });

  return {
    mountVideoEditor(container, options) {
      return manager.mount(container, options);
    },
  };
}

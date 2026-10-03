/**
 * The Host's look on the editor. The dsh-film workbench posts the Host's
 * colour scheme and its resolved alias tokens (`{ source: 'dsh-film', type:
 * 'theme', theme }`) when the page loads and on every change; the editor
 * takes its colours from `--vibedev-editor-*` variables, which are mapped
 * here, with warm neutral fallbacks for any token the Host does not set.
 */

export interface HostTheme {
  scheme: 'light' | 'dark';
  /** Resolved values of the Host's alias tokens; unset ones are left out. */
  tokens?: Readonly<Record<string, string>>;
  fontFamily?: string;
}

interface Palette {
  accent: string;
  background: string;
  surface: string;
  surfaceMuted: string;
  elevated: string;
  border: string;
  text: string;
  textMuted: string;
  danger: string;
}

const PALETTES: Readonly<Record<HostTheme['scheme'], Palette>> = {
  light: {
    accent: '#d77757',
    background: '#faf9f7',
    surface: '#fdfcfa',
    surfaceMuted: '#f4f3f0',
    elevated: '#fffefc',
    border: '#e4e1db',
    text: '#1a1916',
    textMuted: '#74716b',
    danger: '#dc2626',
  },
  dark: {
    accent: '#d77757',
    background: '#1b1a18',
    surface: '#22211f',
    surfaceMuted: '#282724',
    elevated: '#2f2d2a',
    border: '#3a3834',
    text: '#ecebe8',
    textMuted: '#a3a09a',
    danger: '#f87171',
  },
};

/** A plain colour value; anything else (a `var()`, a gradient) falls back. */
const COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color)\([\d\s.,%/+a-z-]+\))$/i;

function color(tokens: Readonly<Record<string, string>> | undefined, name: string, fallback: string): string {
  const value = tokens?.[name]?.trim();
  return value !== undefined && COLOR.test(value) ? value : fallback;
}

/**
 * The editor's theme variables for a Host look.
 * @param theme - the scheme and tokens the workbench sent.
 * @returns `--vibedev-editor-*` values.
 */
export function editorTheme(theme: HostTheme): Record<string, string> {
  const palette = PALETTES[theme.scheme] ?? PALETTES.light;
  const tokens = theme.tokens;
  const accent = color(tokens, '--dsw-alias-brand-primary', palette.accent);
  return {
    '--vibedev-editor-color-scheme': theme.scheme,
    '--vibedev-editor-accent': accent,
    '--vibedev-editor-accent-strong': accent,
    '--vibedev-editor-background': color(tokens, '--dsw-alias-bg-base', palette.background),
    '--vibedev-editor-surface': color(tokens, '--dsw-alias-bg-layer-1', palette.surface),
    '--vibedev-editor-surface-muted': color(tokens, '--dsw-alias-bg-layer-2', palette.surfaceMuted),
    '--vibedev-editor-elevated': color(tokens, '--dsw-alias-bg-layer-3', palette.elevated),
    '--vibedev-editor-border': color(tokens, '--dsw-alias-border-l1', palette.border),
    '--vibedev-editor-text': color(tokens, '--dsw-alias-label-primary', palette.text),
    '--vibedev-editor-text-muted': color(tokens, '--dsw-alias-label-secondary', palette.textMuted),
    '--vibedev-editor-danger': color(tokens, '--dsw-alias-state-error-primary', palette.danger),
  };
}

/** The scheme the page opens with (`?theme=`), before the first message. */
export function initialTheme(search: string = location.search): HostTheme {
  return { scheme: new URLSearchParams(search).get('theme') === 'dark' ? 'dark' : 'light' };
}

/**
 * Put a look on the page: the root's scheme (the editor's stylesheet keys on
 * `html[data-theme]`), the page colours, and the variables on the editor's
 * container, which the editor reads live.
 */
export function applyTheme(theme: HostTheme, container: HTMLElement): void {
  const variables = editorTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = theme.scheme;
  root.style.colorScheme = theme.scheme;
  for (const [name, value] of Object.entries(variables)) {
    container.style.setProperty(name, value);
    root.style.setProperty(name, value);
  }
  document.body.style.background = variables['--vibedev-editor-background']!;
  document.body.style.color = variables['--vibedev-editor-text']!;
  if (theme.fontFamily) document.body.style.fontFamily = theme.fontFamily;
}

/** Whether a window message is the workbench telling the page its look. */
export function themeMessage(data: unknown): HostTheme | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const message = data as { source?: unknown; type?: unknown; theme?: unknown };
  if (message.source !== 'dsh-film' || message.type !== 'theme') return undefined;
  const theme = message.theme as { scheme?: unknown; tokens?: unknown; fontFamily?: unknown } | undefined;
  if (theme?.scheme !== 'light' && theme?.scheme !== 'dark') return undefined;
  const tokens = typeof theme.tokens === 'object' && theme.tokens !== null ? theme.tokens as Record<string, string> : undefined;
  return {
    scheme: theme.scheme,
    ...(tokens ? { tokens } : {}),
    ...(typeof theme.fontFamily === 'string' ? { fontFamily: theme.fontFamily } : {}),
  };
}

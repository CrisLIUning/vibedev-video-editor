export type EmbeddedVendorSourceTransformOptions = {
  vendorSourceRoot: string;
  reactDomShim: string;
  /** Where the editor is served, with leading and trailing `/`; `/video-editor/` by default. */
  base?: string;
};

/** Where Studio serves the editor; other hosts pass their own base. */
export const DEFAULT_EDITOR_BASE = '/video-editor/';

/** Check a base the build was given: an absolute path ending in `/`. */
export function assertEditorBase(base: string): string {
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base)) {
    throw new Error(`the editor base must be an absolute path with a trailing slash, got ${JSON.stringify(base)}`);
  }
  return base;
}

/**
 * Public files copied by Vite and separately emitted worker chunks do not
 * necessarily pass through the main module transform. Keep the rewrite
 * idempotent so it is safe to apply both before and after bundling.
 */
export function transformEmbeddedPublicRootUrls(source: string, base: string = DEFAULT_EDITOR_BASE): string {
  return source
    .replace(/(^|["'`(=:\s])\/assets\//gm, `$1${base}assets/`)
    .replace(/(^|["'`(=:\s])\/vendor\//gm, `$1${base}vendor/`);
}

export function transformEmbeddedVendorSource(
  source: string,
  id: string,
  options: EmbeddedVendorSourceTransformOptions,
): { code: string; map: null } | null {
  const normalizedId = id.split('?')[0]!.replaceAll('\\', '/');
  const normalizedRoot = options.vendorSourceRoot.replaceAll('\\', '/').replace(/\/$/, '');
  if (!normalizedId.startsWith(`${normalizedRoot}/`)) return null;

  const normalizedShim = options.reactDomShim.replaceAll('\\', '/');
  const code = transformEmbeddedPublicRootUrls(
    source.replace(/(["'])react-dom\1/g, JSON.stringify(normalizedShim)),
    options.base ?? DEFAULT_EDITOR_BASE,
  );

  return code === source ? null : { code, map: null };
}

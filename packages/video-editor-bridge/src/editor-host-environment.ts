import type { EditorSurface } from './editor-lifecycle.js';
import { VideoEditorHostError } from './host-contract.js';

let activeSurface: EditorSurface | null = null;

/** Register the single Film editor surface currently visible in VibeDev. The
 * shipping Film workspace owns one timeline at a time, which lets upstream
 * React portals keep their original API while targeting the shadow overlay. */
export function registerEditorHostEnvironment(surface: EditorSurface): () => void {
  if (activeSurface !== null) {
    throw new VideoEditorHostError(
      'EDITOR_ALREADY_MOUNTED',
      'Only one embedded Film editor environment may be active',
    );
  }
  activeSurface = surface;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (activeSurface === surface) activeSurface = null;
  };
}

export function resolveEmbeddedEditorPortalTarget(fallback: Element): Element {
  return activeSurface?.overlayRoot ?? fallback;
}

export function setEmbeddedEditorLanguage(locale: string): void {
  if (activeSurface === null) {
    document.documentElement.lang = locale;
    return;
  }
  activeSurface.mountPoint.lang = locale;
  activeSurface.overlayRoot.lang = locale;
}

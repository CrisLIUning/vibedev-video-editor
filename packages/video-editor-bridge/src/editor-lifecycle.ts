import { VideoEditorHostError } from './host-contract.js';

export interface EditorSurfaceOptions {
  css: string;
  locale: string;
  theme: Record<string, string>;
}

export interface EditorSurface {
  shadowRoot: ShadowRoot;
  mountPoint: HTMLDivElement;
  overlayRoot: HTMLDivElement;
  dispose(): void;
}

const CSS_CUSTOM_PROPERTY = /^--[A-Za-z0-9_-]+$/;

function pauseOwnedMedia(root: ShadowRoot): void {
  for (const element of root.querySelectorAll<HTMLMediaElement>('audio, video')) {
    try {
      element.pause();
    } catch {
      // A detached or partially initialized media element may reject pause.
      // Disposal remains best-effort and must continue releasing the surface.
    }
  }
}

/** Create a DOM boundary that does not leak upstream selectors, language or
 * theme variables into the React 18 application. The upstream stylesheet is
 * injected into the shadow tree rather than the document head. */
export function createEditorSurface(
  container: HTMLElement,
  options: EditorSurfaceOptions,
): EditorSurface {
  if (container.shadowRoot !== null) {
    throw new VideoEditorHostError(
      'EDITOR_ALREADY_MOUNTED',
      'Video editor container already owns a shadow root',
    );
  }

  const previousRootMarker = container.dataset.vibedevVideoEditorRoot;
  const previousTheme = new Map<string, { value: string; priority: string }>();
  const appliedThemeKeys: string[] = [];
  for (const [property, value] of Object.entries(options.theme)) {
    if (!CSS_CUSTOM_PROPERTY.test(property)) continue;
    previousTheme.set(property, {
      value: container.style.getPropertyValue(property),
      priority: container.style.getPropertyPriority(property),
    });
    container.style.setProperty(property, value);
    appliedThemeKeys.push(property);
  }
  container.dataset.vibedevVideoEditorRoot = 'true';

  const shadowRoot = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.dataset.videoEditorStyles = 'true';
  style.textContent = options.css;

  const mountPoint = document.createElement('div');
  mountPoint.dataset.videoEditorBody = 'true';
  mountPoint.lang = options.locale;

  const overlayRoot = document.createElement('div');
  overlayRoot.dataset.videoEditorOverlayRoot = 'true';
  overlayRoot.lang = options.locale;

  shadowRoot.append(style, mountPoint, overlayRoot);
  let disposed = false;

  return {
    shadowRoot,
    mountPoint,
    overlayRoot,
    dispose() {
      if (disposed) return;
      disposed = true;
      pauseOwnedMedia(shadowRoot);
      shadowRoot.replaceChildren();
      if (previousRootMarker === undefined) delete container.dataset.vibedevVideoEditorRoot;
      else container.dataset.vibedevVideoEditorRoot = previousRootMarker;
      for (const property of appliedThemeKeys) {
        const previous = previousTheme.get(property);
        if (!previous || previous.value === '') container.style.removeProperty(property);
        else container.style.setProperty(property, previous.value, previous.priority);
      }
    },
  };
}

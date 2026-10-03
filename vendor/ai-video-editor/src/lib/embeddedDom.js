export function resolveEditorQueryRoot(anchor) {
  const root = anchor?.getRootNode?.();
  return root && typeof root.querySelector === "function" ? root : document;
}

export function queryEditorSelector(anchor, selector) {
  return resolveEditorQueryRoot(anchor).querySelector(selector);
}

export function queryEditorSelectorAll(anchor, selector) {
  return resolveEditorQueryRoot(anchor).querySelectorAll(selector);
}

export function resolveEditorElementFromPoint(anchor, clientX, clientY) {
  const root = resolveEditorQueryRoot(anchor);
  if (typeof root.elementFromPoint === "function") {
    const element = root.elementFromPoint(clientX, clientY);
    if (element) return element;
  }
  return typeof document.elementFromPoint === "function"
    ? document.elementFromPoint(clientX, clientY)
    : null;
}

export function resolveEditorViewport(anchor) {
  const root = anchor?.getRootNode?.();
  const host = root && "host" in root ? root.host : null;
  const rect = host?.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export function editorViewportMatches(anchor, { minWidth = 0, maxWidth = Number.POSITIVE_INFINITY } = {}) {
  const width = resolveEditorViewport(anchor).width;
  return width >= minWidth && width <= maxWidth;
}

export function editorEventPathContains(event, selector) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : [event?.target];
  return path.some((entry) => entry instanceof Element && entry.matches(selector));
}

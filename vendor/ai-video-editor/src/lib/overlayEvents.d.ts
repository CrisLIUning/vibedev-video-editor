export function editorOverlayEventIsInside(
  event: { target?: EventTarget | null; composedPath?: () => EventTarget[] },
  elements: Array<Element | null | undefined>,
): boolean;

export function editorOverlayEventIsInside(event, elements) {
  const candidates = (elements || []).filter(Boolean);
  if (candidates.length === 0) return false;

  const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
  if (path.length > 0 && candidates.some((element) => path.includes(element))) return true;

  const target = event?.target;
  return Boolean(target && candidates.some((element) => element.contains?.(target)));
}

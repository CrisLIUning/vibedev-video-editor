import { queryEditorSelector } from "./embeddedDom.js";

export function isEditorTextEntryTarget(target) {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable='true'], audio[controls], video[controls]",
  ));
}

export function isEditorInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest(
    "button, a, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='slider']",
  ));
}

export function isEditorShortcutBlockedByModal(anchor) {
  if (typeof document === "undefined") return false;
  const modal = queryEditorSelector(anchor, "[role='dialog']");
  if (!modal) return false;
  if (modal.matches(".preview-stage.is-focus-preview")) return false;
  return true;
}

export function releasePointerActivatedFocus(event) {
  if (event?.detail > 0) event.currentTarget?.blur?.();
}

export function getPrimaryShortcutModifier() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

export function formatShortcutLabel(label, shortcut) {
  return shortcut ? `${label} · ${shortcut}` : label;
}

import { isEditorTextEntryTarget } from "./editorShortcuts.js";

/**
 * The host re-imports the WHOLE project whenever its document changes, and its
 * document changes for reasons the person did not cause: the daemon commits an
 * `asset.place_version` for every generated asset, and an agent can edit the
 * timeline at any time. That refresh replaces every piece of editor state.
 *
 * Two of those replacements reach out and touch what the person is doing right
 * now, and together they cost a user their work (field report 2026-09-03):
 * a refresh landed while they were typing, replaced the text in the box, and
 * selected an audio clip they had never selected — so the next Backspace, meant
 * to fix a typo, deleted that clip instead.
 *
 * These helpers draw the line between the two kinds of import. Opening a
 * project file is the person asking for a fresh start, and it may set up the
 * editor however it likes. A host refresh is the same project arriving again,
 * and it must leave the person's caret and selection where they were.
 */

/** True when the host is refreshing the project the editor already has open. */
export function isHostRefresh(importContext) {
  return importContext?.hostDocument === true;
}

/**
 * The audio segment to select once an import finishes.
 *
 * A host refresh keeps what the person had, or selects nothing when that clip
 * is gone — never a clip they did not choose, because a selected clip is what
 * Delete and Backspace act on. Opening a project still selects its first clip.
 */
export function selectedAudioSegmentAfterImport(importContext, previousId, segments = []) {
  const present = segments.some((segment) => segment?.id && segment.id === previousId);
  if (isHostRefresh(importContext)) return present ? previousId : "";
  return segments[0]?.id || "";
}

/**
 * True when replacing editor text right now would pull it out from under a
 * caret. Only a host refresh is ever declined: the local value is authoritative
 * until the person stops typing, and the next snapshot carries it to the host.
 */
export function holdsTextEntry(importContext, activeElement) {
  return isHostRefresh(importContext) && isEditorTextEntryTarget(activeElement);
}

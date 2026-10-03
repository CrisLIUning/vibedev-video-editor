/** Context the editor receives with each project import. */
export interface EditorImportContext {
  hostDocument?: boolean;
}

/** True when the host is refreshing the project the editor already has open. */
export function isHostRefresh(importContext: EditorImportContext | undefined | null): boolean;

/**
 * The audio segment to select once an import finishes. A host refresh keeps what
 * the person had, or nothing — never a clip they did not choose, since a
 * selected clip is what Delete and Backspace act on.
 */
export function selectedAudioSegmentAfterImport(
  importContext: EditorImportContext | undefined | null,
  previousId: string,
  segments?: ReadonlyArray<{ id?: string } | null | undefined>,
): string;

/** True when replacing editor text now would pull it out from under a caret. */
export function holdsTextEntry(
  importContext: EditorImportContext | undefined | null,
  activeElement: Element | null,
): boolean;

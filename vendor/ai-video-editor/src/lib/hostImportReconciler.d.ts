import type { EditorImportContext } from './hostImportPreservation.js';

/**
 * A predicate saying whether the host changed any of the named fields between
 * the payload of the last import and this one. Answers true for everything when
 * there is nothing to compare against — a first import, or the person opening a
 * project — so the default is to apply, and only a field proven untouched is
 * skipped.
 */
export function createHostFieldGate(
  importContext: EditorImportContext | undefined | null,
  incoming: Record<string, unknown> | undefined | null,
  base: Record<string, unknown> | undefined | null,
): (...fields: string[]) => boolean;

import { isHostRefresh } from "./hostImportPreservation.js";

/**
 * The host re-imports the WHOLE project whenever its document changes, and that
 * import replaces every piece of editor state — script, ratio, volume, speed,
 * caption style, track locks, zoom, every track's segments, the playhead. It
 * changes for reasons the person did not cause: the daemon commits an
 * `asset.place_version` for every generated asset, and an agent can edit the
 * timeline at any time.
 *
 * So a refresh triggered by one generated clip rewrote forty-odd unrelated
 * settings, reverting whatever the person had just changed (field report
 * 2026-09-03: text typed into a field kept rolling back).
 *
 * The fix is to stop treating "the document changed" as "everything changed".
 * Remembering the payload of the last import gives a base to compare against,
 * which turns the import into an ordinary three-way reconcile:
 *
 *   base    what the host last gave us
 *   theirs  what the host is giving us now
 *   ours    what the editor currently holds
 *
 * A field where `theirs` equals `base` is one the host did not touch, so `ours`
 * stands — whether or not the person changed it. A field the host did change is
 * applied, because that is the point of the refresh. Opening a project file is
 * not a reconcile at all: the person asked for that content wholesale.
 */

function sameValue(a, b) {
  if (a === b) return true;
  // Both sides come from the same serializer, so key order is stable and a
  // string compare is a sound deep-equality test here.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * A predicate saying whether the host changed any of the named fields.
 *
 * Answers true for everything when there is nothing to compare against — a
 * first import, or the person opening a project — so the default is to apply,
 * and only a field proven untouched is skipped.
 */
export function createHostFieldGate(importContext, incoming, base) {
  if (!isHostRefresh(importContext) || !base || !incoming) return () => true;
  return (...fields) => fields.some((field) => !sameValue(incoming[field], base[field]));
}

import type { JsonObject, JsonValue } from '../host-contract.js';

export interface VideoEditorCommandDiff {
  projectFields: Array<{
    field: string;
    before: JsonValue;
    after: JsonValue;
  }>;
  tracks: Record<string, JsonObject>;
}

export function normalizeVideoEditorCommandDiff(value: unknown): VideoEditorCommandDiff {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    projectFields: Array.isArray(source.projectFields)
      ? source.projectFields as VideoEditorCommandDiff['projectFields']
      : [],
    tracks: source.tracks && typeof source.tracks === 'object' && !Array.isArray(source.tracks)
      ? source.tracks as Record<string, JsonObject>
      : {},
  };
}

export function useHostVisualBackfill<T extends Record<string, unknown>>(options: {
  visualSegments: T[];
  setVisualSegments: (update: (segments: T[]) => T[]) => void;
}): void;

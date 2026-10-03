/** Values read back off the media for a clip that arrived unmeasured. */
export interface VisualMeasurement {
  width?: number;
  height?: number;
  trackFrames?: readonly string[];
  trackFrameDuration?: number;
}

export interface VisualBackfillTarget {
  id: string;
  src: string;
  key: string;
  duration: number;
  needsFrames: boolean;
  needsSize: boolean;
}

/** True when this clip is missing something the editor should have measured. */
export function needsVisualBackfill(segment: unknown): boolean;

/** Identity of one backfill attempt — clip plus source, so new media re-measures. */
export function visualBackfillKey(segment: unknown): string;
export function visualBackfillSourceKey(segment: unknown): string;

/** The clips to measure now, skipping every attempt already made. */
export function visualBackfillTargets<T extends Record<string, unknown>>(
  segments?: readonly T[],
  attempted?: ReadonlySet<string>,
): VisualBackfillTarget[];

/** Fill only what is missing; a measurement never overwrites an authored value. */
export function mergeVisualBackfill<T>(segment: T, measured: VisualMeasurement | null | undefined): T;

/** Apply one clip's measurement, returning the same array when nothing changed. */
export function applyVisualBackfill<T extends Record<string, unknown>>(
  segments: readonly T[] | undefined,
  id: string,
  measured: VisualMeasurement | null | undefined,
): T[];

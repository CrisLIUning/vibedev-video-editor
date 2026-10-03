export function sliceClipSource<T extends Record<string, unknown>>(segment: T, from: number, to: number): T;
export function getClipTrimBounds(segment: Record<string, unknown>): { from: number; to: number };
export function trimClipRange<T extends Record<string, unknown>>(segment: T, from: number, to: number): T;
export function trimClipDuration<T extends Record<string, unknown>>(segment: T, duration: number): T;
export function sourceTimeToClipTime(segment: Record<string, unknown>, sourceTime: number): number;

export function trimClipStart<T extends Record<string, unknown>>(segment: T, requestedStart: number): T;

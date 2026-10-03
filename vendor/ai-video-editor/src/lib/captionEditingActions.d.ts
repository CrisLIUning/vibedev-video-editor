export function getCaptionPositionMode(segment?: { placement?: unknown } | null, fallbackMode?: string): string;
export function isCaptionPlacementLocked(segments: Array<Record<string, any>>, locks?: Record<string, boolean>, segmentId?: string): boolean;
export function setCaptionSegmentPlacement<T extends { id: string }>(segments: T[], segmentId: string, placement: string | { x: number; y: number }): T[];
export function createCaptionEditingActions(dependencies: Record<string, any>): {
  handleCaptionPositionChange(position: string): void;
  applyCaptionPositionToAll(): void;
  startCaptionDrag(event: Record<string, any>, segmentId?: string): void;
  [action: string]: (...args: any[]) => any;
};

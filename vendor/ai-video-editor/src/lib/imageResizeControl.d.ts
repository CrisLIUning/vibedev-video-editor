export function createImageResizeControl(deps: Record<string, any>): (
  event: { button: number; clientX: number; pointerType?: string; preventDefault(): void; stopPropagation(): void },
  segmentId?: string, segmentIndex?: number, edge?: 'start' | 'end',
) => void;

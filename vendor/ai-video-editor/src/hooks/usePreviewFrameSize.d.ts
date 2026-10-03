export function isValidPreviewShellMeasurement(shell: HTMLElement | null): boolean;
export function usePreviewFrameSize(
  shellRef: { current: HTMLElement | null },
  ratio: { width: number; height: number },
  compactRail: boolean,
  shellNode?: HTMLElement | null,
): { width: number; height: number };

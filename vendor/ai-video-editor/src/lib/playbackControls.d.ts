export function createPlaybackControls(dependencies: Record<string, any>): {
  seekTo(time: number, options?: { immediate?: boolean; playing?: boolean }): void;
  startTimelineSeek(event: Record<string, any>): void;
  pauseTimelineMedia(): void;
  handlePlayToggle(): void;
  getTimelineTimeFromClientX(clientX: number): number;
};

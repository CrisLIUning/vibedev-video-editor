export interface VisualTimeRemapRuntimeStep {
  kind: 'play' | 'freeze';
  durationSeconds: number;
  sourceInSeconds?: number;
  sourceOutSeconds?: number;
  sourceSeconds?: number;
  rate?: number;
  reverse?: boolean;
}

export interface VisualTimeRemapSegment {
  duration?: number;
  playbackRate?: number;
  sourceStart?: number;
  sourceDuration?: number;
  speedCurve?: unknown;
  vibedevTimeRemapRuntime?: {
    duration: number;
    segments: VisualTimeRemapRuntimeStep[];
  };
}

export function getVisualSourceTime(segment: Record<string, any>, localTime?: number): number;
export function getVisualPlaybackRateAtTime(
  segment: Record<string, any>,
  localTime?: number,
): number;
export function requiresTimelineDrivenVideoFrames(segment: Record<string, any>): boolean;
export function shouldUseNativeVisualPlayback(
  segment: Record<string, any>,
  isPlaying: boolean,
  visible?: boolean,
): boolean;
export function shouldSeekPreviewVideoOnSegmentChange(
  previousSegment: Record<string, any> | null | undefined,
  nextSegment: Record<string, any> | null | undefined,
  isPlaying: boolean,
): boolean;
export function resizeVisualSegmentDuration(
  segment: Record<string, any>,
  requestedDuration: number,
  options?: { nextSegment?: Record<string, any> | null },
): Record<string, any>;

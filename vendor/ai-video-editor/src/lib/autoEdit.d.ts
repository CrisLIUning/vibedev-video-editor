export interface AutoEditFrame {
  segmentId: string;
  segmentIndex: number;
  segmentName: string;
  segmentStart: number;
  segmentEnd: number;
  time: number;
  blob?: Blob;
  /** Scene change since the previous frame, 0-1. */
  difference?: number;
  /**
   * How much picture the frame carries, 0-1, from `frameQuality` in the
   * auto-edit worker: lit pixels plus local contrast. A frame the extractor
   * failed to draw scores 0.
   */
  quality?: number;
}

/** Below this, a frame carries no picture worth describing. */
export const MIN_FRAME_QUALITY: number;

/** Progress for one clip as its batches are described. */
export interface AutoEditPartial {
  segmentId: string;
  status: 'running' | 'complete' | 'empty' | 'error';
  captions: AutoEditCaption[];
  error?: string;
  windowIndex?: number;
  totalWindows?: number;
  completedWindows?: number;
  allWindows?: number;
}

export interface AutoEditCaption {
  id: string;
  text: string;
  start: number;
  end: number;
  visualSegmentId: string;
}

export function generateFrameCaptions(options: {
  frames: AutoEditFrame[];
  duration: number;
  language: string;
  session?: unknown;
  translator?: unknown;
  describeFrames?: (
    frames: AutoEditFrame[],
    signal?: AbortSignal,
  ) => Promise<string[]>;
  onDownloadProgress?: (loaded: number) => void;
  onPartial?: (result: AutoEditPartial) => void;
  signal?: AbortSignal;
}): Promise<AutoEditCaption[]>;

export function probeBuiltInAI(language: string): Promise<Record<string, unknown>>;
export function createFrameCaptionSession(options: Record<string, unknown>): Promise<unknown>;
export function createAutoEditTranslator(options: Record<string, unknown>): Promise<unknown>;
export function extractAutoEditFrames(...args: unknown[]): Promise<AutoEditFrame[]>;
export function generateImageVoiceoverText(options: Record<string, unknown>): Promise<string>;

/**
 * The frame that stands for a segment: the first one carrying an image, or the
 * first frame when the segment is dark throughout. Every segment gets one, so
 * this is the single selection that bypasses the change threshold — which is
 * why it must not also bypass the quality gate.
 */
export function segmentAnchorFrame<T extends { quality?: number }>(runFrames: readonly T[]): T;

/** Frames worth describing: one anchor per segment, plus the biggest changes. */
export function selectChangedFrames<T extends { quality?: number; difference?: number }>(
  frames: readonly T[],
  options?: { threshold?: number; maxFrames?: number; minTimeGap?: number },
): T[];

/** True for a cancellation, which must stop the run rather than be retried. */
export function isAbortError(error: unknown): boolean;

/** Runs one batch, retrying once after a backoff if the model did not answer. */
export function describeWindowWithRetry<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
  delayMs?: number,
): Promise<T>;

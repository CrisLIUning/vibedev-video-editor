import type { VideoEditorCapabilityRuntime } from '../../../../packages/video-editor-bridge/src/host-contract.js';

export interface AutoEditReviewResult {
  durationSeconds: number;
  candidates: Array<Record<string, unknown>>;
  captions: Array<Record<string, unknown>>;
  segments: Array<Record<string, unknown>>;
}

export function startAutoEditCapability(options: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  language: string;
  segmentCount: number;
  signal?: AbortSignal;
}): Promise<null | {
  signal: AbortSignal;
  progress(update: { progress?: number; phase?: string }): Promise<void>;
  complete(review: AutoEditReviewResult): Promise<unknown>;
  fail(error: unknown): Promise<void>;
  cancel(): Promise<void>;
}>;

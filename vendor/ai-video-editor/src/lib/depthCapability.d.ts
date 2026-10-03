import type { VideoEditorAnalysisOutput, VideoEditorCapabilityOutput, VideoEditorCapabilityRuntime } from '../../../../packages/video-editor-bridge/src/host-contract.js';

export type DepthCapabilitySource = VideoEditorAnalysisOutput['source'] & {
  localAssetId?: string;
  name?: string;
  blob?: Blob;
};

export interface DepthCapabilitySession {
  signal: AbortSignal;
  source: DepthCapabilitySource;
  modelArtifacts: Record<string, string>;
  model: VideoEditorAnalysisOutput['model'];
  progress(update: { progress?: number; phase?: string }): Promise<void>;
  complete(output: Pick<VideoEditorCapabilityOutput, 'files' | 'analysisResult'>): Promise<unknown>;
  fail(error: unknown): Promise<void>;
  cancel(): Promise<void>;
}

export function startDepthCapability(input: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  title: string;
  source: DepthCapabilitySource;
  signal?: AbortSignal;
}): Promise<DepthCapabilitySession | null>;

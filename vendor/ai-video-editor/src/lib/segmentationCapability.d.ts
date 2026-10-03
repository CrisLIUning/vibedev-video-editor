import type {
  JsonObject,
  VideoEditorAnalysisOutput,
  VideoEditorCapabilityRuntime,
} from '../../../../packages/video-editor-bridge/src/host-contract.js';

export type SegmentationCapabilitySource = VideoEditorAnalysisOutput['source'] & {
  localAssetId?: string;
  name?: string;
  blob?: Blob;
};

export interface SegmentationCapabilitySession {
  signal: AbortSignal;
  source: SegmentationCapabilitySource | null;
  modelArtifacts: Record<string, string>;
  preparedModels: Array<{ id: string; revision: string }>;
  progress(update: { progress?: number; phase?: string }): Promise<void>;
  complete(output: JsonObject | {
    files: Array<{ blob: Blob; fileName: string; mimeType?: string; title?: string; analysisRole: string }>;
    analysisResult: VideoEditorAnalysisOutput;
  }): Promise<unknown>;
  fail(error: unknown): Promise<void>;
  cancel(): Promise<void>;
}

export function startSegmentationCapability(input: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  title: string;
  signal?: AbortSignal;
  modelIds?: string[];
  source?: SegmentationCapabilitySource;
}): Promise<SegmentationCapabilitySession | null>;

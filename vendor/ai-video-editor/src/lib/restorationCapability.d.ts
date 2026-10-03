import type {
  VideoEditorAssetKind,
  VideoEditorCapabilityCompletion,
  VideoEditorCapabilityPlacement,
  VideoEditorCapabilityProgress,
  VideoEditorCapabilityRuntime,
} from '../../../../packages/video-editor-bridge/src/host-contract.js';

export interface RestorationCapabilitySession {
  signal: AbortSignal;
  modelArtifacts: Record<string, string>;
  progress(update: VideoEditorCapabilityProgress): Promise<void>;
  complete(
    blob: Blob,
    fileName: string,
    placement?: VideoEditorCapabilityPlacement,
  ): Promise<VideoEditorCapabilityCompletion | null>;
  fail(error: unknown): Promise<void>;
  cancel(): Promise<void>;
}

export function startModelMediaCapability(options: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  capability: 'repair' | 'restoration';
  modelId: string;
  outputKind: Exclude<VideoEditorAssetKind, 'audio' | 'font'>;
  title: string;
  signal?: AbortSignal;
  failureCode: string;
}): Promise<RestorationCapabilitySession | null>;

export function startRestorationCapability(options: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  outputKind: Exclude<VideoEditorAssetKind, 'audio' | 'font'>;
  title: string;
  signal?: AbortSignal;
}): Promise<RestorationCapabilitySession | null>;

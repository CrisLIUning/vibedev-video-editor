import type {
  VideoEditorAssetKind,
  VideoEditorCapabilityCompletion,
  VideoEditorCapabilityProgress,
  VideoEditorCapabilityRuntime,
} from '../../../../packages/video-editor-bridge/src/host-contract.js';

export interface FaceSwapCapabilitySession {
  signal: AbortSignal;
  modelArtifacts: Record<string, string>;
  progress(update: VideoEditorCapabilityProgress): Promise<void>;
  complete(
    blob: Blob,
    fileName: string,
    placement?: { track: 'visuals'; duration: number },
  ): Promise<VideoEditorCapabilityCompletion | null>;
  fail(error: unknown): Promise<void>;
  cancel(): Promise<void>;
}

export function startFaceSwapCapability(input: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  outputKind: Exclude<VideoEditorAssetKind, 'audio' | 'font'>;
  title: string;
}): Promise<FaceSwapCapabilitySession | null>;

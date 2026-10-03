import type {
  VideoEditorCapabilityCompletion,
  VideoEditorCapabilityPlacement,
  VideoEditorCapabilityProgress,
  VideoEditorCapabilityRuntime,
} from '../../../../packages/video-editor-bridge/src/host-contract.js';

export interface AvatarCapabilitySession {
  signal: AbortSignal;
  modelArtifacts: Record<string, string>;
  progress(update: VideoEditorCapabilityProgress): Promise<void>;
  complete(
    blob: Blob,
    fileName: string,
    placement: VideoEditorCapabilityPlacement,
  ): Promise<VideoEditorCapabilityCompletion | null>;
  fail(error: unknown): Promise<void>;
  cancel(): Promise<void>;
}

export function startAvatarCapability(input: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  title: string;
  quality?: 'preview' | 'quality';
  signal?: AbortSignal;
}): Promise<AvatarCapabilitySession | null>;

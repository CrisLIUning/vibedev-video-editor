import type { VideoEditorCapabilityRuntime } from '../../../../packages/video-editor-bridge/src/host-contract.js';

interface VoiceItem {
  blob: Blob;
  script: string;
  placement?: import('../../../../packages/video-editor-bridge/src/host-contract.js').VideoEditorCapabilityPlacement;
  [key: string]: unknown;
}

interface PersistedVoiceItem extends VoiceItem {
  hostAssetId?: string;
  hostVersionId?: string;
  hostUrl?: string;
}

/** One line of spoken text, collapsed and truncated to fit on a card. */
export function voiceScriptExcerpt(script: string | undefined | null): string;

/**
 * The voice a clip was actually spoken in. Cloning selects a profile while the
 * engine voice stays the built-in one, so the profile wins when present.
 */
export function effectiveVoiceName(
  voiceName: string | undefined | null,
  voiceProfileName: string | undefined | null,
): string;

/**
 * What a generated voice clip is called in the media panel: the spoken line
 * first, then the voice. A clip with no text to quote keeps a counter.
 */
export function voiceClipTitle(
  script: string | undefined | null,
  voiceName: string,
  index: number,
  total: number,
): string;

export function startVoiceGenerationCapability(options: {
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  voiceName: string;
  /** Name of the cloned voice profile in use, when the person cloned a voice. */
  voiceProfileName?: string;
  voiceId?: string;
  voiceEngine?: string;
  segmentCount: number;
}): Promise<{
  signal?: AbortSignal;
  modelArtifacts?: Record<string, string>;
  progress(update: { progress?: number; phase?: string }): Promise<void>;
  complete(items: VoiceItem[]): Promise<PersistedVoiceItem[]>;
  fail(error: unknown): Promise<void>;
}>;

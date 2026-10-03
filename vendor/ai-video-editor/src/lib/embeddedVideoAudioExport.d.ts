/** A video clip on the main visual track, as the export reads it. */
export interface EmbeddedVideoAudioSegment {
  id: string;
  name?: string;
  type?: string;
  src?: string;
  blob?: Blob | null;
  assetId?: string;
  duration?: number;
  sourceStart?: number;
  sourceDuration?: number;
  playbackRate?: number;
  sourceAudioDisabled?: boolean;
  compatibilityAudioBlob?: Blob | null;
}

/**
 * A clip whose own sound the export was supposed to mix and could not get.
 * Carries where it plays, because a clip outside the range being exported
 * costs that render nothing. A take with no audio stream is never one of
 * these: there is nothing to lose and nothing to report.
 */
export interface LostSourceAudioClip {
  id: string;
  name: string;
  start: number;
  duration: number;
}

/** One clip's sound, placed on the mix the export builds. */
export interface EmbeddedVideoAudioMixSegment {
  id: string;
  assetId?: string | undefined;
  start: number;
  duration: number;
  sourceStart: number;
  sourceDuration: number;
  playbackRate: number;
}

export function createEmbeddedVideoAudioSegments(
  visualSegments?: readonly EmbeddedVideoAudioSegment[],
  audioAssets?: Map<string, { offset: number; duration: number }>,
): EmbeddedVideoAudioMixSegment[];

export function prepareEmbeddedVideoAudio(
  visualSegments?: readonly EmbeddedVideoAudioSegment[],
  onProgress?: (step: { progress: number; phaseKey?: string; phaseParams?: Record<string, unknown> }) => void,
  signal?: AbortSignal,
): Promise<{
  blob: Blob | null;
  segments: EmbeddedVideoAudioMixSegment[];
  lost: LostSourceAudioClip[];
}>;

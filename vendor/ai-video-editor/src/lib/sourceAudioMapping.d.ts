export function getVisualAudioSource(segment: Record<string, unknown>, options?: {
  hasSourceAudio?: boolean; sourceAudioAssetId?: string; visualSegments?: Array<Record<string, unknown>>;
}): 'silent' | 'source' | 'embedded';
export function getLinkedSourceAudioSegments(visualSegments?: Array<Record<string, unknown>>, sourceAudioAssetId?: string, sourceAudioDuration?: number): Array<{
  id: string; assetId: string; start: number; duration: number; sourceStart: number;
  sourceDuration: number; playbackRate: number; speedCurve?: unknown; availableSourceDuration?: number;
}>;

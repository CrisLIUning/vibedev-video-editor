export interface PersistedAudioSegment {
  id: string;
  assetId: string;
  assetVersionId: string;
  sourceUrl: string;
  [key: string]: unknown;
}

export function createAudioTrackActions(deps: Record<string, any>): {
  replaceAudio(
    blob: Blob,
    duration: number,
    peaks: number[],
    statusText: string,
    options?: Record<string, any>,
  ): PersistedAudioSegment;
  commitAudio(blob: Blob, statusText: string, options?: Record<string, any>): Promise<void>;
  commitAudioBatch(items: Array<Record<string, any>>, statusText: string, options?: Record<string, any>): Promise<PersistedAudioSegment[]>;
  clearAudioTrack(message?: string): void;
  clearMusicTrack(message?: string): void;
  clearSourceAudioTrack(message?: string): void;
};

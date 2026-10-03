export interface AudioClipExport {
  kind: 'audio';
  name: string;
  blob: Blob;
  durationSeconds: number;
}

export function renderAudioClipFile(
  segment: Record<string, unknown>,
  authorizedAssets?: ReadonlyArray<Record<string, unknown>>,
): Promise<AudioClipExport>;

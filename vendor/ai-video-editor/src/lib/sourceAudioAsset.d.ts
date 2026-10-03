export interface SourceAudioAsset {
  assetId?: string;
  assetVersionId?: string;
  versionId?: string;
  type?: string;
  src?: string;
  sourceUrl?: string;
  hostAuthorized?: boolean;
  blob?: Blob | null;
}

export function resolveSourceAudioInputAsset<T extends SourceAudioAsset>(
  asset: SourceAudioAsset | null | undefined,
  authorizedUserAssets?: T[],
): T | SourceAudioAsset | null;

export function loadSourceAudioBlob(
  asset: SourceAudioAsset | null | undefined,
  authorizedUserAssets?: SourceAudioAsset[],
  loader?: (asset: SourceAudioAsset, onProgress?: (progress: number) => void) => Promise<Blob | null>,
  onProgress?: (progress: number) => void,
): Promise<Blob | null>;

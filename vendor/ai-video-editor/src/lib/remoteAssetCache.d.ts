export interface FetchableAssetSource { src?: string; hostAuthorized?: boolean; blob?: Blob }
export function isFetchableAssetSource(asset: FetchableAssetSource | null | undefined): boolean;
export function clearRemoteAssetCache(): void;
export function getRemoteAssetBlob(asset: FetchableAssetSource, onProgress?: (progress: number) => void): Promise<Blob | null>;

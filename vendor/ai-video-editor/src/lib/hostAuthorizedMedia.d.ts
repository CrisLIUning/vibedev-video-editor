export interface HostAuthorizedMediaAsset {
  assetId: string;
  versionId: string;
  kind: string;
  name?: string;
  url: string;
  mimeType?: string;
  durationSeconds?: number;
  /**
   * True when this is an OLDER version of its asset. Every version stays in the
   * list because the list is what authorizes a timeline clip's source, but the
   * media library shows one card per asset and adds none for these. Absent
   * means current.
   */
  supersededVersion?: boolean;
}

export function resolveAuthorizedProjectMediaSource(
  url: string,
  kind: string,
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
): HostAuthorizedMediaAsset | null;

export function loadAuthorizedProjectMediaBlob(
  url: string,
  kind: string,
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Blob>;

/**
 * The authorized AssetVersion an audio-lane segment plays from, or null when
 * it names none. Throws when it names one the host did not authorize.
 */
export function resolveAuthorizedAudioSegmentSource(
  segment: Record<string, unknown>,
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
): HostAuthorizedMediaAsset | null;

/**
 * The same segments, each carrying the bytes it plays. A host-restored clip
 * holds only its source URL; the browser export mixes Blobs. Unauthorized and
 * unreadable clips come back untouched.
 */
export function loadAuthorizedAudioSegmentMedia<T extends Record<string, unknown>>(
  segments?: readonly T[],
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
  options?: {
    fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
    extractVideoAudio?: ((file: Blob, filename?: string) => Promise<Blob>) | null;
    onProgress?: (progress: { current: number; total: number }) => void;
    signal?: AbortSignal;
  },
): Promise<Array<T & { blob?: Blob }>>;

export function restoreAuthorizedAudioSegmentSource<T extends Record<string, unknown>>(
  segment: T,
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
): (T & { url: string; peaks: never[] }) | null;
export function restoreAuthorizedVisualSegmentSource<T extends Record<string, unknown>>(
  segment: T,
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
): (T & { assetId: string; assetVersionId: string; sourceUrl: string; src: string }) | null;

export interface HostAuthorizedUserAsset extends Record<string, unknown>, HostIdentity {
  id: string;
  type: string;
  src: string;
  sourceUrl: string;
  name: string;
  duration: number;
  hostAuthorized: true;
}

export function authorizedAssetToUserAsset(
  asset: HostAuthorizedMediaAsset,
): HostAuthorizedUserAsset | null;

/** One host AssetVersion identity, under every field name the editor uses. */
export interface HostIdentity {
  assetId: string;
  versionId: string;
  assetVersionId: string;
  hostAssetId: string;
  hostVersionId: string;
  hostUrl?: string;
}

/**
 * The host AssetVersion an asset already belongs to, under any spelling, or ""
 * when it belongs to none. Merging keys on this so a producer cannot
 * reintroduce a duplicate card by recording only `hostVersionId`.
 */
export function hostVersionIdOf(asset: unknown): string;

/** Stamp a host identity onto an asset under every spelling. */
export function withHostIdentity<T extends object>(
  asset: T,
  authorized: { assetId: string; versionId: string; url?: string },
): T & HostIdentity;

export interface HostProjectFile {
  id: string;
  path: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  mtime?: number;
}

export function projectFileToUserAsset(
  file: HostProjectFile,
): Record<string, unknown> | null;

export function mergeProjectFileUserAssets<T extends Record<string, unknown>>(
  current?: readonly T[],
  projectFiles?: readonly HostProjectFile[],
): Array<T | Record<string, unknown>>;

export function mergeAuthorizedUserAssets<T extends Record<string, unknown>>(
  current?: readonly T[],
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
): Array<T | HostAuthorizedUserAsset>;

/** Seconds when the value is a finite positive number, else undefined. */
export function measuredSeconds(value: unknown): number | undefined;

export function hostMediaMeta(kind: string | undefined, duration: number): string;

/**
 * Duration fields to spread over an asset once the host reports seconds for
 * it; empty when the asset already carries a measured duration.
 */
export function adoptMeasuredDuration(
  asset: { type?: string; duration?: unknown } | null | undefined,
  seconds: unknown,
): { duration?: number; meta?: string };

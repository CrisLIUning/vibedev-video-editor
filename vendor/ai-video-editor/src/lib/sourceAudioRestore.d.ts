import type { HostAuthorizedMediaAsset } from './hostAuthorizedMedia.js';
import type { EditorImportContext } from './hostImportPreservation.js';

/**
 * The AssetVersion a source-audio lane's sound was cut from, recorded in the
 * snapshot as `sourceAudioSource` and read back on import. The field names are
 * the ones `resolveAuthorizedAudioSegmentSource` already reads, so the lane
 * passes through the same authorization gate as every other host medium.
 */
export interface SourceAudioOrigin {
  assetId: string;
  assetVersionId: string;
  sourceUrl: string;
  /** `video` asks for an extraction; anything else is taken as sound already. */
  sourceKind: 'video' | 'audio';
}

/** The lane the editor currently holds, and where its sound came from. */
export interface HeldSourceAudio {
  blob: Blob | null;
  source?: Partial<SourceAudioOrigin> | null;
}

/** What a host import should do with the source-audio lane. */
export type HostSourceAudioAction = 'restore' | 'keep' | 'record' | 'clear';

export function sourceAudioIdentity(
  source: Partial<SourceAudioOrigin> | undefined | null,
): SourceAudioOrigin | null;

export function documentNamesSourceAudio(
  project: Record<string, unknown> | undefined | null,
): boolean;

export function holdsHostSourceAudio(
  project: Record<string, unknown> | undefined | null,
  held: HeldSourceAudio | undefined | null,
): boolean;

export function hostSourceAudioAction(
  project: Record<string, unknown> | undefined | null,
  held: HeldSourceAudio | undefined | null,
  blob: Blob | null | undefined,
  importContext?: EditorImportContext | null,
): HostSourceAudioAction;

/**
 * The sound of the lane's origin, or null when the lane names none, names one
 * the host did not authorize, or the bytes will not come. Never throws: a
 * superseded take is ordinary and the cut still has to open.
 */
export function loadHostSourceAudioBlob(
  source: Partial<SourceAudioOrigin> | undefined | null,
  authorizedAssets?: readonly HostAuthorizedMediaAsset[],
  options?: {
    fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
    extractVideoAudio?: ((file: Blob, name: string) => Promise<Blob>) | null;
  },
): Promise<Blob | null>;

export interface PendingVisualAssetIdentity {
  id?: string | null;
  assetId?: string | null;
}

export interface DroppedVisualAssetIdentity {
  id?: string | null;
  assetId?: string | null;
}

export function resolvePendingVisualAssetId(
  pendingSegment?: PendingVisualAssetIdentity | null,
  asset?: DroppedVisualAssetIdentity | null,
): string;

export interface AssetDropActions {
  applyAssetToTrack(asset: Record<string, unknown>, track: string, options?: Record<string, unknown>): Promise<void>;
  handleTrackAssetDrop(event: unknown, track: string): void;
  handleVisualStyleDrop(event: unknown): void;
}

export function createAssetDropActions(dependencies: unknown): AssetDropActions;

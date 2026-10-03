export interface VisualAssetPayload extends Record<string, unknown> {
  assetId: string;
  assetVersionId: string;
  sourceUrl: string;
  type: string;
  src: string;
  blob: Blob | null;
}

export function getVisualAssetPayload(
  asset: Record<string, unknown> | null,
): Partial<VisualAssetPayload>;

export function shouldAutoAddImportedVisual(
  assets: readonly Array<{ type?: string }>,
  visualSegments: readonly unknown[],
): boolean;

export function claimDeferredFirstVisual(
  claimRef: { current: string },
  localAssetId: string,
  visualSegments: readonly unknown[],
  userAssets: readonly Array<{ id?: string }>,
): boolean;

export function useFileUpload(
  deps: Record<string, unknown>,
): (files: FileList | readonly File[] | null | undefined) => void;

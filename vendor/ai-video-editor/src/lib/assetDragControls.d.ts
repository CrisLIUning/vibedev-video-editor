export { resolveEditorElementFromPoint } from './embeddedDom.js';

export function resolveAssetDragPreviewPosition(
  clientX: number,
  clientY: number,
  rootRect?: Pick<DOMRect, 'left' | 'top'> | null,
): { x: number; y: number };

export function resolveVisualDropIntent(options?: { track?: string }): 'overlay' | 'image';
export function resolveStickerSelectionIntent(options?: { isMobile?: boolean }): 'stage' | 'add';
export function isAssetReadyForTimeline(asset?: {
  id?: string;
  type?: string;
  requiresPin?: boolean;
  pinning?: boolean;
  pinError?: boolean;
  assetVersionId?: string;
  versionId?: string;
} | null): boolean;
export function createAssetDragControls(deps: Record<string, unknown>): Record<string, unknown>;

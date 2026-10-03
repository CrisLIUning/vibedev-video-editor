export function configureObjectSegmentationModels(input?: {
  modelUrls?: Record<string, string>;
}): Promise<void>;

export function detectObjectsWithNanoDet(input: {
  blob: Blob;
  signal?: AbortSignal;
  onProgress?: (update: { progress?: number; phase?: string }) => void;
  scoreThreshold?: number;
}): Promise<unknown>;

export function prepareObjectSegmenter(input?: {
  signal?: AbortSignal;
}): Promise<unknown>;

export function segmentObjectWithMagicTouch(
  blob: Blob,
  point: { x?: number; y?: number },
  options?: { signal?: AbortSignal; threshold?: number },
): Promise<{ alpha: Uint8ClampedArray; width: number; height: number }>;

export function disposeObjectSegmentationModels(): Promise<void>;

type VisualRecord = Record<string, unknown>;

export function createVisualTimelineActions(dependencies: Record<string, unknown>): {
  appendVisualAssetToTimeline(asset: VisualRecord, options?: { message?: string }): VisualRecord | null;
  clearImageTrack(message?: string): void;
  commitVisualSegments(segments: VisualRecord[], message?: string, selectedIndex?: number): void;
  getCurrentVisualAssetSnapshot(): VisualRecord;
  getVisualDurationForAsset(asset: VisualRecord, fallbackDuration?: number): number;
  replaceVisualTimeline(asset: VisualRecord, duration?: number): void;
  setCurrentVisualAsset(asset: VisualRecord): void;
  updateVisualAssetInTimeline(assetId: string, updates: VisualRecord): void;
};

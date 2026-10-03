export async function ensurePinnedCapabilitySource(capabilityRuntime, source, capabilityLabel) {
  if (!source?.clipId) throw new Error(`${capabilityLabel} requires a selected timeline clip`);
  if (source.assetId && source.versionId) return source;
  if (typeof capabilityRuntime?.pinSourceAsset !== "function" || !(source?.blob instanceof Blob)) {
    throw new Error(`${capabilityLabel} requires the local media to be added again before analysis`);
  }
  const pinned = await capabilityRuntime.pinSourceAsset({
    localAssetId: String(source.localAssetId || source.assetId || source.clipId),
    kind: source.mediaType === "video" ? "video" : "image",
    name: String(source.name || (source.mediaType === "video" ? "local-video.mp4" : "local-image.png")),
    blob: source.blob,
  });
  return {
    ...source,
    assetId: pinned.assetId,
    versionId: pinned.versionId,
    sourceUrl: pinned.url,
  };
}

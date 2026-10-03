import { getRemoteAssetBlob } from "./remoteAssetCache.js";

export function resolveSourceAudioInputAsset(asset, authorizedUserAssets = []) {
  if (asset?.blob instanceof Blob) return asset;

  const assetId = asset?.assetId || "";
  const versionId = asset?.assetVersionId || asset?.versionId || "";
  const sourceUrl = asset?.sourceUrl || asset?.src || "";
  if (!assetId || !versionId || !sourceUrl) return null;
  return authorizedUserAssets.find((candidate) => (
    candidate?.hostAuthorized === true
    && candidate.type === "video"
    && candidate.assetId === assetId
    && (candidate.assetVersionId || candidate.versionId) === versionId
    && (candidate.sourceUrl || candidate.src) === sourceUrl
  )) || null;
}

export async function loadSourceAudioBlob(
  asset,
  authorizedUserAssets = [],
  loader = getRemoteAssetBlob,
  onProgress = () => {},
) {
  if (asset?.blob instanceof Blob) return asset.blob;
  const source = resolveSourceAudioInputAsset(asset, authorizedUserAssets);
  if (!source) return null;
  return loader(source, onProgress);
}

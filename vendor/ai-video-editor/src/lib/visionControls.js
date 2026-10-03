import { revokeVisionObjectUrls } from "./editorRuntime.js";

export function createVisionControls(deps) {
  function setFitModeFromUser(nextModeOrUpdater) {
    deps.setFitMode(nextModeOrUpdater);
  }

  function removeVisionRecordsForAsset(asset) {
    if (!asset?.id && !asset?.src) return;
    const belongs = (key) => Boolean(
      (asset.id && key.startsWith(`${asset.id}::`))
      || (asset.src && key.includes(`::${asset.src}`)),
    );
    if (deps.visionJob.running && belongs(deps.visionJob.key)) {
      deps.visionJobGenerationRef.current += 1;
      deps.visionAbortControllerRef.current?.abort();
      deps.visionAbortControllerRef.current = null;
      deps.setVisionJob({ running: false, key: "", progress: 0, phase: "" });
    }
    deps.setVisionRecords((records) => {
      const next = { ...records };
      Object.keys(records).forEach((key) => {
        if (!belongs(key)) return;
        const urls = deps.visionObjectUrlsRef.current.get(key);
        if (urls) {
          revokeVisionObjectUrls(urls);
          deps.visionObjectUrlsRef.current.delete(key);
        }
        delete next[key];
      });
      return next;
    });
  }

  return { removeVisionRecordsForAsset, setFitModeFromUser };
}

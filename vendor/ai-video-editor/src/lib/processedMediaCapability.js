import { withHostIdentity } from "./hostAuthorizedMedia.js";

// Task provenance is a reference to the pinned timeline, not a serialized editor
// asset. Preview frames, data URLs, waveform samples and generation history stay
// in the renderer. The original source (including its curve) still drives DSP.
function sourceTaskReference(source) {
  const reference = {};
  for (const key of ["id", "segmentId", "assetId", "assetVersionId", "track", "type", "sourceKind"]) {
    if (typeof source[key] === "string") reference[key] = source[key];
  }
  if (typeof source.name === "string") reference.name = source.name.slice(0, 256);
  for (const key of ["start", "duration", "sourceStart", "sourceDuration", "playbackRate", "sourceAudioOffset", "volume", "fadeIn", "fadeOut"]) {
    if (typeof source[key] === "number" && Number.isFinite(source[key])) reference[key] = source[key];
  }
  for (const key of ["muted", "wholeSource"]) {
    if (typeof source[key] === "boolean") reference[key] = source[key];
  }
  return reference;
}

/** One host task owns inference, durable outputs and a pinned timeline commit. */
export async function startProcessedMedia(runtime, { capability, title, outputKind = "audio", source = {}, signal }) {
  if (!runtime?.captureTimeline || !runtime?.complete) throw new Error("MEDIA_RUNTIME_UNAVAILABLE");
  signal?.throwIfAborted();
  const timelineRevision = await runtime.captureTimeline();
  signal?.throwIfAborted();
  const request = { schemaVersion: 1, requestId: crypto.randomUUID(), capability, title, outputKind,
    inputVersionIds: source.assetVersionId ? [source.assetVersionId] : [],
    parameters: { timelineRevision, source: sourceTaskReference(source) } };
  const task = await runtime.start(request);
  let settled = false;
  const abort = () => { if (!settled) void runtime.cancel(task.taskId).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const check = () => { signal?.throwIfAborted(); task.signal.throwIfAborted(); };
  const cleanup = () => signal?.removeEventListener("abort", abort);
  return {
    request, task, check,
    async progress(update) { check(); await runtime.progress(task.taskId, update); },
    async complete(files) {
      check();
      const completion = await runtime.complete(task.taskId, request, { files });
      // A completed commit remains a fact even if Cancel arrived during its reply.
      settled = true; cleanup();
      const assets = completion.assets || (completion.asset ? [completion.asset] : []);
      if (assets.length !== files.length) throw new Error("MEDIA_OUTPUT_COUNT_MISMATCH");
      return files.map((file, index) => ({ ...withHostIdentity(file, assets[index]), id: `vibedev-${assets[index].versionId}`, src: assets[index].url, sourceUrl: assets[index].url, hostAuthorized: true, timelineRevision, taskId: task.taskId }));
    },
    async fail(error) { cleanup(); if (settled) return; settled = true; if (!task.signal.aborted && !signal?.aborted) await runtime.fail(task.taskId, { code: "MEDIA_PROCESSING_FAILED", message: error?.message || String(error) }).catch(() => {}); },
  };
}

import { ensurePinnedCapabilitySource } from "./pinnedCapabilitySource.js";

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function startDepthCapability({ capabilityRuntime, title, source, signal }) {
  if (!capabilityRuntime) return null;
  const pinnedSource = await ensurePinnedCapabilitySource(capabilityRuntime, source, "Depth analysis");
  if (signal?.aborted) throw signal.reason || new DOMException("Canceled", "AbortError");
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    capability: "depth",
    title,
    outputKind: pinnedSource.mediaType === "video" ? "video" : "image",
    inputVersionIds: [pinnedSource.versionId],
    parameters: {
      sourceAssetId: pinnedSource.assetId,
      sourceClipId: pinnedSource.clipId,
    },
  };
  const task = await capabilityRuntime.start(request);
  const combined = new AbortController();
  const abortFromHost = () => combined.abort(task.signal.reason);
  const abortFromEditor = () => {
    combined.abort(signal?.reason);
    void capabilityRuntime.cancel(task.taskId).catch(() => undefined);
  };
  task.signal.addEventListener("abort", abortFromHost, { once: true });
  signal?.addEventListener("abort", abortFromEditor, { once: true });
  if (task.signal.aborted) abortFromHost();
  if (signal?.aborted) abortFromEditor();
  const cleanup = () => {
    task.signal.removeEventListener("abort", abortFromHost);
    signal?.removeEventListener("abort", abortFromEditor);
  };
  let settled = false;
  try {
    const prepared = await capabilityRuntime.prepareModel?.({
      modelId: "depth-anything-v2-small",
      signal: combined.signal,
      onProgress(update) {
        void capabilityRuntime.progress(task.taskId, {
          progress: Math.min(35, Math.round((Number(update.progress) || 0) * 0.35)),
          phase: update.phase,
        }).catch(() => undefined);
      },
    });
    if (!prepared) throw new Error("Depth analysis requires the VibeDev host model cache");
    return {
      signal: combined.signal,
      source: pinnedSource,
      modelArtifacts: prepared.artifacts || {},
      model: { id: String(prepared.modelId), revision: String(prepared.revision) },
      async progress(update) {
        if (settled || combined.signal.aborted) throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        await capabilityRuntime.progress(task.taskId, update);
      },
      async complete(output) {
        if (combined.signal.aborted) throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        if (settled) return null;
        settled = true;
        try {
          return await capabilityRuntime.complete(task.taskId, request, output);
        } catch (error) {
          if (!combined.signal.aborted) await capabilityRuntime.fail(task.taskId, {
            code: "VIDEO_EDITOR_DEPTH_COMPLETE_FAILED", message: message(error),
          }).catch(() => undefined);
          throw error;
        } finally {
          cleanup();
        }
      },
      async fail(error) {
        if (settled) return;
        settled = true;
        cleanup();
        await capabilityRuntime.fail(task.taskId, { code: "VIDEO_EDITOR_DEPTH_FAILED", message: message(error) });
      },
      async cancel() {
        if (settled) return;
        settled = true;
        cleanup();
        await capabilityRuntime.cancel(task.taskId);
      },
    };
  } catch (error) {
    cleanup();
    if (error?.name === "AbortError") await capabilityRuntime.cancel(task.taskId).catch(() => undefined);
    else await capabilityRuntime.fail(task.taskId, {
      code: "VIDEO_EDITOR_MODEL_PREPARE_FAILED", message: message(error),
    }).catch(() => undefined);
    throw error;
  }
}

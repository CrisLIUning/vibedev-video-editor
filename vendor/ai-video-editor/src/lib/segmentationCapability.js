import { ensurePinnedCapabilitySource } from "./pinnedCapabilitySource.js";

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function startSegmentationCapability({
  capabilityRuntime,
  title,
  signal,
  modelIds = ["object-segmentation-v1", "slimsam-77-uniform"],
  source,
}) {
  if (!capabilityRuntime) return null;
  const requestedModelIds = [...new Set(modelIds.filter((modelId) => typeof modelId === "string" && modelId))];
  if (!requestedModelIds.length) throw new Error("Segmentation requires at least one model");
  const pinnedSource = source
    ? await ensurePinnedCapabilitySource(capabilityRuntime, source, "Segmentation analysis")
    : null;
  if (signal?.aborted) throw signal.reason || new DOMException("Canceled", "AbortError");
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    capability: "segmentation",
    title,
    outputKind: pinnedSource?.mediaType === "video" ? "video" : "image",
    ...(pinnedSource?.versionId ? { inputVersionIds: [pinnedSource.versionId] } : {}),
    parameters: {
      modelIds: requestedModelIds,
      ...(pinnedSource?.assetId ? { sourceAssetId: pinnedSource.assetId } : {}),
      ...(pinnedSource?.clipId ? { sourceClipId: pinnedSource.clipId } : {}),
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
    const modelArtifacts = {};
    const preparedModels = [];
    if (capabilityRuntime.prepareModel) {
      for (let index = 0; index < requestedModelIds.length; index += 1) {
        const modelId = requestedModelIds[index];
        const prepared = await capabilityRuntime.prepareModel({
          modelId,
          signal: combined.signal,
          onProgress(update) {
            const completed = index / requestedModelIds.length;
            const current = (Math.max(0, Math.min(100, Number(update.progress) || 0)) / 100)
              / requestedModelIds.length;
            void capabilityRuntime.progress(task.taskId, {
              progress: Math.min(35, Math.round((completed + current) * 35)),
              phase: update.phase,
            }).catch(() => undefined);
          },
        });
        preparedModels.push({
          id: String(prepared?.modelId || modelId),
          revision: String(prepared?.revision || "unknown"),
        });
        for (const [artifactId, artifactUrl] of Object.entries(prepared?.artifacts || {})) {
          if (Object.hasOwn(modelArtifacts, artifactId)) {
            throw new Error(`Duplicate segmentation artifact id: ${artifactId}`);
          }
          modelArtifacts[artifactId] = artifactUrl;
        }
      }
    }
    return {
      signal: combined.signal,
      source: pinnedSource,
      modelArtifacts,
      preparedModels,
      async progress(update) {
        if (settled || combined.signal.aborted) {
          throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        }
        await capabilityRuntime.progress(task.taskId, update);
        if (combined.signal.aborted) {
          throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        }
      },
      async complete(output) {
        if (combined.signal.aborted) {
          throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        }
        if (settled) return null;
        settled = true;
        try {
          const capabilityOutput = output?.files || output?.analysisResult || output?.documentResult
            ? output
            : { documentResult: output };
          const completed = await capabilityRuntime.complete(task.taskId, request, capabilityOutput);
          if (combined.signal.aborted) {
            throw combined.signal.reason || new DOMException("Canceled", "AbortError");
          }
          return completed;
        } catch (error) {
          if (!combined.signal.aborted) {
            await capabilityRuntime.fail(task.taskId, {
              code: "VIDEO_EDITOR_SEGMENTATION_COMPLETE_FAILED",
              message: message(error),
            }).catch(() => undefined);
          }
          throw error;
        } finally {
          cleanup();
        }
      },
      async fail(error) {
        if (settled) return;
        settled = true;
        cleanup();
        await capabilityRuntime.fail(task.taskId, {
          code: error?.code || "VIDEO_EDITOR_SEGMENTATION_FAILED",
          message: message(error),
        });
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
    if (error?.name === "AbortError") {
      await capabilityRuntime.cancel(task.taskId).catch(() => undefined);
    } else {
      await capabilityRuntime.fail(task.taskId, {
        code: "VIDEO_EDITOR_MODEL_PREPARE_FAILED",
        message: message(error),
      }).catch(() => undefined);
    }
    throw error;
  }
}

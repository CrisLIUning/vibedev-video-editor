function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function startFaceSwapCapability({ capabilityRuntime, outputKind, title }) {
  if (!capabilityRuntime) return null;
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    capability: "face-swap",
    title,
    outputKind,
    parameters: { modelId: "mobilefaceswap-224" },
  };
  const task = await capabilityRuntime.start(request);
  let settled = false;
  try {
    const prepared = capabilityRuntime.prepareModel
      ? await capabilityRuntime.prepareModel({
          modelId: "mobilefaceswap-224",
          signal: task.signal,
          onProgress(update) {
            void capabilityRuntime.progress(task.taskId, {
              progress: Math.min(35, Math.round(update.progress * 0.35)),
              phase: update.phase,
            }).catch(() => undefined);
          },
        })
      : null;
    return {
      signal: task.signal,
      modelArtifacts: prepared?.artifacts || {},
      async progress(update) {
        if (!settled && !task.signal.aborted) await capabilityRuntime.progress(task.taskId, update);
      },
      async complete(blob, fileName, placement) {
        if (settled) return null;
        settled = true;
        return capabilityRuntime.complete(task.taskId, request, {
          blob,
          fileName,
          mimeType: blob.type || (outputKind === "image" ? "image/png" : "video/webm"),
          placement,
        });
      },
      async fail(error) {
        if (settled) return;
        settled = true;
        await capabilityRuntime.fail(task.taskId, {
          code: error?.code || "VIDEO_EDITOR_FACE_SWAP_FAILED",
          message: message(error),
        });
      },
      async cancel() {
        if (settled) return;
        settled = true;
        await capabilityRuntime.cancel(task.taskId);
      },
    };
  } catch (error) {
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

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function startModelMediaCapability({
  capabilityRuntime,
  capability,
  modelId,
  outputKind,
  title,
  signal,
  failureCode,
}) {
  if (!capabilityRuntime) return null;
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    capability,
    title,
    outputKind,
    parameters: { modelId },
  };
  const task = await capabilityRuntime.start(request);
  const combined = new AbortController();
  let settled = false;
  function cleanup() {
    task.signal.removeEventListener("abort", abortFromHost);
    signal?.removeEventListener("abort", abortFromEditor);
  }
  function abortFromHost() {
    settled = true;
    cleanup();
    combined.abort(task.signal.reason || new DOMException("Canceled", "AbortError"));
  }
  function abortFromEditor() {
    settled = true;
    cleanup();
    combined.abort(signal?.reason);
    void capabilityRuntime.cancel(task.taskId).catch(() => undefined);
  }
  task.signal.addEventListener("abort", abortFromHost, { once: true });
  signal?.addEventListener("abort", abortFromEditor, { once: true });
  if (task.signal.aborted) abortFromHost();
  if (signal?.aborted) abortFromEditor();
  try {
    const prepared = capabilityRuntime.prepareModel
      ? await capabilityRuntime.prepareModel({
          modelId,
          signal: combined.signal,
          onProgress(update) {
            void capabilityRuntime.progress(task.taskId, {
              progress: Math.min(35, Math.round(update.progress * 0.35)),
              phase: update.phase,
            }).catch(() => undefined);
          },
        })
      : null;
    if (combined.signal.aborted) {
      throw combined.signal.reason || new DOMException("Canceled", "AbortError");
    }
    return {
      signal: combined.signal,
      modelArtifacts: prepared?.artifacts || {},
      async progress(update) {
        if (settled || combined.signal.aborted) {
          throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        }
        await capabilityRuntime.progress(task.taskId, update);
        if (combined.signal.aborted) {
          throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        }
      },
      async complete(blob, fileName, placement) {
        if (combined.signal.aborted) {
          throw combined.signal.reason || new DOMException("Canceled", "AbortError");
        }
        if (settled) return null;
        settled = true;
        try {
          const completed = await capabilityRuntime.complete(task.taskId, request, {
            blob,
            fileName,
            mimeType: blob.type || (outputKind === "video" ? "video/webm" : "image/png"),
            placement,
          });
          if (combined.signal.aborted) {
            throw combined.signal.reason || new DOMException("Canceled", "AbortError");
          }
          return completed;
        } finally {
          cleanup();
        }
      },
      async fail(error) {
        if (settled) return;
        settled = true;
        cleanup();
        await capabilityRuntime.fail(task.taskId, {
          code: error?.code || failureCode,
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

export function startRestorationCapability(options) {
  return startModelMediaCapability({
    ...options,
    capability: "restoration",
    modelId: "nanovsr-644k",
    failureCode: "VIDEO_EDITOR_RESTORATION_FAILED",
  });
}

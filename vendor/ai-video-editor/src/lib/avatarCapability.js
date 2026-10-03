function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function canceled(signal) {
  return signal.reason || new DOMException("Canceled", "AbortError");
}

const LIVE_PORTRAIT_GENERATOR_MODELS = Object.freeze({
  preview: "liveportrait-webgpu-preview",
  quality: "liveportrait-webgpu-quality",
});

export async function startAvatarCapability({ capabilityRuntime, title, quality = "preview", signal }) {
  if (!capabilityRuntime) return null;
  const generatorQuality = quality === "quality" ? "quality" : "preview";
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    capability: "avatar",
    title,
    outputKind: "video",
    parameters: { pipeline: "joyvasa-liveportrait", quality: generatorQuality },
  };
  const task = await capabilityRuntime.start(request);
  const combined = new AbortController();
  let settled = false;
  const abortFromHost = () => combined.abort(task.signal.reason);
  const abortFromEditor = () => {
    combined.abort(signal?.reason);
    void capabilityRuntime.cancel(task.taskId).catch(() => undefined);
  };
  const cleanup = () => {
    task.signal.removeEventListener("abort", abortFromHost);
    signal?.removeEventListener("abort", abortFromEditor);
  };
  task.signal.addEventListener("abort", abortFromHost, { once: true });
  signal?.addEventListener("abort", abortFromEditor, { once: true });
  if (task.signal.aborted) abortFromHost();
  if (signal?.aborted) abortFromEditor();

  let modelArtifacts = {};
  try {
    if (capabilityRuntime.prepareModel) {
      const modelIds = [
        "joyvasa-webgpu",
        "liveportrait-webgpu-common",
        LIVE_PORTRAIT_GENERATOR_MODELS[generatorQuality],
      ];
      for (let index = 0; index < modelIds.length; index += 1) {
        const prepared = await capabilityRuntime.prepareModel({
          modelId: modelIds[index],
          signal: combined.signal,
          onProgress(update) {
            const completed = index + Math.max(0, Math.min(100, Number(update.progress) || 0)) / 100;
            void capabilityRuntime.progress(task.taskId, {
              progress: Math.min(35, Math.round((completed / modelIds.length) * 35)),
              phase: update.phase,
            }).catch(() => undefined);
          },
        });
        for (const [artifactId, artifactUrl] of Object.entries(prepared?.artifacts || {})) {
          if (Object.hasOwn(modelArtifacts, artifactId)) {
            throw new Error(`Duplicate avatar model artifact: ${artifactId}`);
          }
          modelArtifacts[artifactId] = artifactUrl;
        }
      }
    }
    if (combined.signal.aborted) throw canceled(combined.signal);
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

  return {
    signal: combined.signal,
    modelArtifacts,
    async progress(update) {
      if (settled || combined.signal.aborted) throw canceled(combined.signal);
      await capabilityRuntime.progress(task.taskId, update);
      if (combined.signal.aborted) throw canceled(combined.signal);
    },
    async complete(blob, fileName, placement) {
      if (combined.signal.aborted) throw canceled(combined.signal);
      if (settled) return null;
      settled = true;
      try {
        const completed = await capabilityRuntime.complete(task.taskId, request, {
          blob,
          fileName,
          mimeType: blob.type || "video/webm",
          placement,
        });
        if (combined.signal.aborted) throw canceled(combined.signal);
        return completed;
      } catch (error) {
        if (!combined.signal.aborted) {
          await capabilityRuntime.fail(task.taskId, {
            code: "VIDEO_EDITOR_AVATAR_COMPLETE_FAILED",
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
        code: error?.code || "VIDEO_EDITOR_AVATAR_FAILED",
        message: message(error),
      });
    },
    async cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      combined.abort(new DOMException("Canceled", "AbortError"));
      await capabilityRuntime.cancel(task.taskId);
    },
  };
}

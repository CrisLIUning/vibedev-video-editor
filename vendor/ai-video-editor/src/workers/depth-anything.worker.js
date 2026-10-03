import { RawImage, env, pipeline } from "@huggingface/transformers";
import {
  DEPTH_MODEL_HUGGING_FACE_REVISION,
  DEPTH_MODEL_MODELSCOPE_REVISION,
  DEPTH_MODEL_PATH,
  DEPTH_MODEL_REPOSITORY,
} from "../lib/depthOfField.js";
import { loadFromMirroredRepository, resolveHostModelFile } from "../lib/modelSources.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

let estimatorPromise = null;
let hostModelArtifacts = null;

const HOST_FILE_KEYS = Object.freeze({
  "config.json": "config",
  "preprocessor_config.json": "preprocessor",
  "onnx/model_q4f16.onnx": "model-q4f16",
});

function configureHostModelFiles(modelArtifacts) {
  if (modelArtifacts) hostModelArtifacts = modelArtifacts;
  modelArtifacts = hostModelArtifacts;
  const missing = Object.values(HOST_FILE_KEYS).filter((id) => !modelArtifacts?.[id]);
  if (missing.length) throw new Error(`Host depth model is missing artifacts: ${missing.join(", ")}`);
  env.useBrowserCache = false;
  env.useCustomCache = true;
  // Transformers.js validates that at least one model resolution path is
  // enabled before consulting customCache. Host artifacts are the local path;
  // remote loading stays disabled so a cache miss cannot escape to a hub.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.customCache = {
    async match(request) {
      const file = resolveHostModelFile(request, HOST_FILE_KEYS);
      if (!file) return undefined;
      const response = await fetch(modelArtifacts[HOST_FILE_KEYS[file]]);
      if (!response.ok) throw new Error(`Host depth model returned HTTP ${response.status}: ${file}`);
      return response;
    },
    async put() {},
  };
}

function progressValue(event) {
  if (event?.status === "progress" && Number.isFinite(event.progress)) return event.progress;
  if (event?.status === "done" || event?.status === "ready") return 100;
  return null;
}

async function getEstimator(modelArtifacts) {
  configureHostModelFiles(modelArtifacts);
  estimatorPromise ??= loadFromMirroredRepository(env, {
    repository: DEPTH_MODEL_REPOSITORY,
    modelPath: DEPTH_MODEL_PATH,
    huggingFaceRevision: DEPTH_MODEL_HUGGING_FACE_REVISION,
    modelScopeRevision: DEPTH_MODEL_MODELSCOPE_REVISION,
  }, (modelPath) => pipeline("depth-estimation", modelPath, {
    device: "webgpu",
    dtype: "q4f16",
    progress_callback: (event) => {
      const progress = progressValue(event);
      self.postMessage({ type: "setup-progress", progress, status: event?.status || "" });
    },
  })).catch((error) => {
    estimatorPromise = null;
    throw error;
  });
  return estimatorPromise;
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "setup") {
      await getEstimator(message.modelArtifacts);
      self.postMessage({ type: "ready", requestId: message.requestId });
      return;
    }
    if (message.type !== "infer" || !message.bitmap) return;
    const estimator = await getEstimator(message.modelArtifacts);
    const canvas = new OffscreenCanvas(message.width, message.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(message.bitmap, 0, 0, message.width, message.height);
    message.bitmap.close?.();
    const input = RawImage.fromCanvas(canvas);
    const output = await estimator(input);
    const depth = output.depth;
    const pixels = new Uint8Array(depth.data);
    self.postMessage({
      type: "result",
      requestId: message.requestId,
      width: depth.width,
      height: depth.height,
      pixels: pixels.buffer,
    }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

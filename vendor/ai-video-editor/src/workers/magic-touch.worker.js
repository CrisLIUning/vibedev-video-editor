import {
  FilesetResolver,
  InteractiveSegmenterLegacy,
} from "@mediapipe/tasks-vision";
import { fetchFirstAvailableModel, mirroredModelFileUrls } from "../lib/modelSources.js";

const WASM_ROOT = "/vendor/mediapipe/vision";
const MODEL_REPOSITORY = "timeline-studio-onnx-models";
const MODEL_REVISION = "f1005093a90dec7a23746518f9623ee6aaba9cdc";
const MODEL_PATH = "object-outline/magic_touch_512.tflite";
const MODEL_BYTES = 18_000_426;

let hostModelUrl = "";
let segmenterPromise = null;

function postProgress(requestId, progress, phase) {
  self.postMessage({ requestId, type: "progress", progress, phase });
}

async function releaseSegmenter() {
  const segmenter = await segmenterPromise?.catch(() => null);
  segmenter?.close?.();
  segmenterPromise = null;
}

async function configure(modelUrl) {
  const next = typeof modelUrl === "string" ? modelUrl : "";
  if (next === hostModelUrl) return;
  await releaseSegmenter();
  hostModelUrl = next;
}

async function getSegmenter(requestId) {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      postProgress(requestId, 8, "加载 MagicTouch 实物分割模型");
      const modelUrls = hostModelUrl
        ? [hostModelUrl]
        : mirroredModelFileUrls({
            repository: MODEL_REPOSITORY,
            revision: MODEL_REVISION,
            path: MODEL_PATH,
          });
      const [{ response }, fileset] = await Promise.all([
        fetchFirstAvailableModel(modelUrls),
        FilesetResolver.forVisionTasks(WASM_ROOT),
      ]);
      const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
      if (modelAssetBuffer.byteLength !== MODEL_BYTES) {
        throw new Error(`MAGIC_TOUCH_MODEL_SIZE_MISMATCH:${modelAssetBuffer.byteLength}:${MODEL_BYTES}`);
      }
      const create = (delegate) => InteractiveSegmenterLegacy.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer, delegate },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      try {
        return await create("GPU");
      } catch (error) {
        console.warn("MagicTouch GPU 初始化失败，回退 CPU。", error);
        return create("CPU");
      }
    })().catch((error) => {
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

async function segment(requestId, blob, point, thresholdValue) {
  if (!(blob instanceof Blob)) throw new TypeError("MagicTouch 需要有效图片。");
  const initializedAt = performance.now();
  const segmenter = await getSegmenter(requestId);
  const initializedMs = performance.now() - initializedAt;
  const bitmap = await createImageBitmap(blob);
  const inferenceStartedAt = performance.now();
  const result = segmenter.segment(bitmap, {
    keypoint: {
      x: Math.max(0, Math.min(1, Number(point?.x) || 0.5)),
      y: Math.max(0, Math.min(1, Number(point?.y) || 0.5)),
    },
  });
  const inferenceMs = performance.now() - inferenceStartedAt;
  try {
    const mask = result.confidenceMasks?.[1] || result.confidenceMasks?.at(-1);
    if (!mask) throw new Error("MagicTouch 没有返回实物蒙版。");
    const probabilities = mask.getAsFloat32Array();
    const alpha = new Uint8ClampedArray(probabilities.length);
    const threshold = Math.max(0.2, Math.min(0.8, Number(thresholdValue) || 0.5));
    for (let index = 0; index < probabilities.length; index += 1) {
      const probability = Math.max(0, Math.min(1, probabilities[index]));
      alpha[index] = probability >= threshold ? Math.round(probability * 255) : 0;
    }
    return {
      alpha: alpha.buffer,
      maskWidth: mask.width,
      maskHeight: mask.height,
      width: bitmap.width,
      height: bitmap.height,
      initializedMs,
      inferenceMs,
      totalMs: initializedMs + inferenceMs,
      qualityScore: Number(result.qualityScores?.[1] ?? result.qualityScores?.at(-1)) || 0,
      modelId: "MediaPipe MagicTouch 512",
      modelPath: `${MODEL_REPOSITORY}@${MODEL_REVISION}/${MODEL_PATH}`,
    };
  } finally {
    result.close?.();
    bitmap.close();
  }
}

self.addEventListener("message", async (event) => {
  const { requestId, type, modelUrl, blob, point, threshold } = event.data || {};
  if (!requestId) return;
  try {
    await configure(modelUrl);
    if (type === "prepare") {
      await getSegmenter(requestId);
      self.postMessage({ requestId, type: "prepared" });
      return;
    }
    if (type !== "segment") return;
    const result = await segment(requestId, blob, point, threshold);
    self.postMessage({ requestId, type: "result", result }, [result.alpha]);
  } catch (error) {
    self.postMessage({
      requestId,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

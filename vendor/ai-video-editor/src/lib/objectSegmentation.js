const pendingDetectionRequests = new Map();
const pendingMagicTouchRequests = new Map();
let detectorWorker = null;
let magicTouchWorker = null;
let hostModelUrls = null;
let configuredDetectorUrl = "";

function requestId(prefix) {
  return globalThis.crypto?.randomUUID
    ? `${prefix}-${globalThis.crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError() {
  const error = new Error("实物描边分析已取消。");
  error.name = "AbortError";
  return error;
}

function rejectPending(map, error) {
  map.forEach((pending) => {
    pending.signal?.removeEventListener("abort", pending.handleAbort);
    pending.reject(error);
  });
  map.clear();
}

function resetDetectorWorker(error = null) {
  detectorWorker?.terminate();
  detectorWorker = null;
  configuredDetectorUrl = "";
  if (error) rejectPending(pendingDetectionRequests, error);
}

function resetMagicTouchWorker(error = null) {
  magicTouchWorker?.terminate();
  magicTouchWorker = null;
  if (error) rejectPending(pendingMagicTouchRequests, error);
}

function getDetectorWorker() {
  if (detectorWorker) return detectorWorker;
  detectorWorker = new Worker(new URL("../workers/nanodet.worker.js", import.meta.url), { type: "module" });
  detectorWorker.addEventListener("message", (event) => {
    const message = event.data;
    const pending = pendingDetectionRequests.get(message?.requestId);
    if (!pending) return;
    if (message.type === "progress") {
      pending.onProgress?.(message);
      return;
    }
    pendingDetectionRequests.delete(message.requestId);
    pending.signal?.removeEventListener("abort", pending.handleAbort);
    if (message.type === "result") pending.resolve(message.result);
    else if (message.type === "configured") pending.resolve(message);
    else pending.reject(new Error(message.error || "NanoDet-Plus 实物检测失败。"));
  });
  detectorWorker.addEventListener("error", (event) => {
    const error = new Error(event.message || "NanoDet-Plus Worker 运行失败。");
    resetDetectorWorker(error);
  });
  return detectorWorker;
}

function getMagicTouchWorker() {
  if (magicTouchWorker) return magicTouchWorker;
  magicTouchWorker = new Worker(new URL("../workers/magic-touch.worker.js", import.meta.url), { type: "module" });
  magicTouchWorker.addEventListener("message", (event) => {
    const message = event.data;
    const pending = pendingMagicTouchRequests.get(message?.requestId);
    if (!pending) return;
    if (message.type === "progress") {
      pending.onProgress?.(message);
      return;
    }
    pendingMagicTouchRequests.delete(message.requestId);
    pending.signal?.removeEventListener("abort", pending.handleAbort);
    if (message.type === "result") {
      pending.resolve({ ...message.result, alpha: new Uint8ClampedArray(message.result.alpha) });
    } else if (message.type === "prepared") {
      pending.resolve(message);
    } else {
      pending.reject(new Error(message.error || "MagicTouch 实物分割失败。"));
    }
  });
  magicTouchWorker.addEventListener("error", (event) => {
    resetMagicTouchWorker(new Error(event.message || "MagicTouch Worker 运行失败。"));
  });
  return magicTouchWorker;
}

function requestMagicTouch(type, payload, signal, onProgress) {
  if (signal?.aborted) return Promise.reject(abortError());
  const worker = getMagicTouchWorker();
  const id = requestId(`magic-touch-${type}`);
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      const pending = pendingMagicTouchRequests.get(id);
      if (pending) {
        pendingMagicTouchRequests.delete(id);
        pending.reject(abortError());
      }
      resetMagicTouchWorker(abortError());
    };
    pendingMagicTouchRequests.set(id, { resolve, reject, signal, onProgress, handleAbort });
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage({
      requestId: id,
      type,
      modelUrl: hostModelUrls?.["magic-touch"] || "",
      ...payload,
    });
  });
}

async function configureDetectorWorker(signal) {
  const modelUrl = hostModelUrls?.nanodet || "";
  if (!modelUrl || configuredDetectorUrl === modelUrl) return;
  const worker = getDetectorWorker();
  const id = requestId("nanodet-configure");
  await new Promise((resolve, reject) => {
    const handleAbort = () => {
      pendingDetectionRequests.delete(id);
      reject(abortError());
      resetDetectorWorker(abortError());
    };
    pendingDetectionRequests.set(id, { resolve, reject, signal, handleAbort });
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage({ requestId: id, type: "configure", modelUrl });
  });
  configuredDetectorUrl = modelUrl;
}

export async function configureObjectSegmentationModels({ modelUrls } = {}) {
  const next = modelUrls && typeof modelUrls === "object" ? modelUrls : null;
  if (JSON.stringify(next) === JSON.stringify(hostModelUrls)) return;
  await disposeObjectSegmentationModels();
  hostModelUrls = next;
}

export async function detectObjectsWithNanoDet({ blob, signal, onProgress, scoreThreshold = 0.24 }) {
  if (signal?.aborted) return Promise.reject(abortError());
  await configureDetectorWorker(signal);
  const worker = getDetectorWorker();
  const id = requestId("nanodet");
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      pendingDetectionRequests.delete(id);
      reject(abortError());
      resetDetectorWorker(abortError());
    };
    pendingDetectionRequests.set(id, {
      resolve,
      reject,
      signal,
      onProgress,
      handleAbort,
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage({ requestId: id, type: "detect", blob, scoreThreshold });
  });
}

export function selectPrimaryObject(detections, previousSubject = null) {
  const candidates = (detections || []).filter((item) => {
    if (!item?.box || String(item.label).toLowerCase() === "person") return false;
    const width = Math.max(0, item.box.xmax - item.box.xmin);
    const height = Math.max(0, item.box.ymax - item.box.ymin);
    return width * height >= 0.008 && width <= 0.98 && height <= 0.98;
  });
  const previousBox = previousSubject?.box;
  const previousLabel = previousSubject?.label;
  const overlap = (left, right) => {
    if (!left || !right) return 0;
    const width = Math.max(0, Math.min(left.xmax, right.xmax) - Math.max(left.xmin, right.xmin));
    const height = Math.max(0, Math.min(left.ymax, right.ymax) - Math.max(left.ymin, right.ymin));
    const intersection = width * height;
    const leftArea = (left.xmax - left.xmin) * (left.ymax - left.ymin);
    const rightArea = (right.xmax - right.xmin) * (right.ymax - right.ymin);
    return intersection / Math.max(0.000001, leftArea + rightArea - intersection);
  };
  return candidates
    .map((item) => {
      const width = item.box.xmax - item.box.xmin;
      const height = item.box.ymax - item.box.ymin;
      const area = width * height;
      const centerX = (item.box.xmin + item.box.xmax) / 2;
      const centerY = (item.box.ymin + item.box.ymax) / 2;
      const centered = Math.max(0, 1 - Math.hypot(centerX - 0.5, centerY - 0.5) / 0.71);
      const previousIoU = overlap(item.box, previousBox);
      const identityBonus = previousLabel && item.label === previousLabel ? 0.5 : 0;
      return {
        ...item,
        rank: Number(item.score) * 0.55 + Math.min(0.25, area) + centered * 0.2
          + previousIoU * 1.2 + identityBonus,
      };
    })
    .sort((left, right) => right.rank - left.rank)[0] || null;
}

export async function prepareObjectSegmenter({ signal } = {}) {
  if (signal?.aborted) throw abortError();
  const segmenter = await requestMagicTouch("prepare", {}, signal);
  if (signal?.aborted) throw abortError();
  return segmenter;
}

function resizeAlpha(alpha, sourceWidth, sourceHeight, width, height) {
  if (sourceWidth === width && sourceHeight === height) return alpha;
  const source = document.createElement("canvas");
  source.width = sourceWidth;
  source.height = sourceHeight;
  const sourceContext = source.getContext("2d");
  const imageData = sourceContext.createImageData(sourceWidth, sourceHeight);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = alpha[index];
  }
  sourceContext.putImageData(imageData, 0, 0);
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const targetContext = target.getContext("2d", { willReadFrequently: true });
  targetContext.drawImage(source, 0, 0, width, height);
  const rgba = targetContext.getImageData(0, 0, width, height).data;
  const resized = new Uint8ClampedArray(width * height);
  for (let index = 0; index < resized.length; index += 1) resized[index] = rgba[index * 4 + 3];
  return resized;
}

export async function segmentObjectWithMagicTouch(blob, point, options = {}) {
  if (options.signal?.aborted) throw abortError();
  const result = await requestMagicTouch("segment", {
    blob,
    point,
    threshold: options.threshold,
  }, options.signal, options.onProgress);
  if (options.signal?.aborted) throw abortError();
  return {
    ...result,
    alpha: resizeAlpha(result.alpha, result.maskWidth, result.maskHeight, result.width, result.height),
  };
}

export async function disposeObjectSegmentationModels() {
  resetDetectorWorker(abortError());
  resetMagicTouchWorker(abortError());
}

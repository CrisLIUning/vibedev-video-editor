import { YOLOS_TINY_MODEL_REVISION } from "../config/models.js";
import { analyzeVisualSubject, captureVisualFrame } from "./vision.js";
import { normalizeVisualPlaybackRate } from "./visualEffects.js";

const pendingFlowRequests = new Map();
let flowWorker = null;
let flowReadyPromise = null;
let nativeFaceDetector;

function createAbortError() {
  const error = typeof DOMException !== "undefined"
    ? new DOMException("智能构图分析已取消", "AbortError")
    : new Error("智能构图分析已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() || `smart-frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resetFlowWorker(error = null) {
  flowWorker?.terminate();
  flowWorker = null;
  flowReadyPromise = null;
  if (error) {
    pendingFlowRequests.forEach(({ reject }) => reject(error));
    pendingFlowRequests.clear();
  }
}

function getFlowWorker() {
  if (flowWorker && flowReadyPromise) return { worker: flowWorker, ready: flowReadyPromise };
  if (typeof Worker === "undefined") throw new Error("当前浏览器不支持光流 Worker");
  flowWorker = new Worker(new URL("../workers/smart-frame-flow.worker.js", import.meta.url));
  flowReadyPromise = new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data?.type === "ready") resolve(event.data);
      if (event.data?.type === "fatal") reject(new Error(event.data.error || "光流初始化失败"));
    };
    flowWorker.addEventListener("message", onMessage);
  });
  flowWorker.addEventListener("message", (event) => {
    const message = event.data;
    const pending = pendingFlowRequests.get(message?.requestId);
    if (!pending) return;
    pendingFlowRequests.delete(message.requestId);
    pending.signal?.removeEventListener("abort", pending.onAbort);
    if (message.type === "result") pending.resolve(message.result || {});
    else pending.reject(new Error(message.error || "光流跟踪失败"));
  });
  flowWorker.addEventListener("error", (event) => resetFlowWorker(new Error(event.message || "光流 Worker 运行失败")));
  return { worker: flowWorker, ready: flowReadyPromise };
}

async function requestFlow(type, payload, signal) {
  throwIfAborted(signal);
  const { worker, ready } = getFlowWorker();
  await ready;
  throwIfAborted(signal);
  const id = requestId();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pendingFlowRequests.delete(id);
      resetFlowWorker();
      reject(createAbortError());
    };
    pendingFlowRequests.set(id, { resolve, reject, signal, onAbort });
    signal?.addEventListener("abort", onAbort, { once: true });
    const message = { requestId: id, type, ...payload };
    const transfer = message.rgba instanceof ArrayBuffer ? [message.rgba] : [];
    worker.postMessage(message, transfer);
  });
}

function waitForEvent(target, eventName, errorName, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener(errorName, onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onSuccess = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("无法读取当前视频片段")); };
    const onAbort = () => { cleanup(); reject(createAbortError()); };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener(errorName, onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function seekVideo(video, time, signal) {
  throwIfAborted(signal);
  if (video.readyState < 1) await waitForEvent(video, "loadedmetadata", "error", signal);
  const target = Math.max(0, Math.min(Number(time) || 0, Math.max(0, (Number(video.duration) || 0) - 0.002)));
  if (Math.abs(video.currentTime - target) < 0.008) return;
  const ready = waitForEvent(video, "seeked", "error", signal);
  video.currentTime = target;
  await ready;
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.86) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("无法编码视觉分析帧"));
  }, type, quality));
}

function translateBox(box, dx, dy, width, height) {
  if (!box) return null;
  const offsetX = (Number(dx) || 0) / Math.max(1, width);
  const offsetY = (Number(dy) || 0) / Math.max(1, height);
  const xMin = Math.max(0, Math.min(1, Number(box.xMin ?? box.xmin) + offsetX));
  const yMin = Math.max(0, Math.min(1, Number(box.yMin ?? box.ymin) + offsetY));
  const xMax = Math.max(0, Math.min(1, Number(box.xMax ?? box.xmax) + offsetX));
  const yMax = Math.max(0, Math.min(1, Number(box.yMax ?? box.ymax) + offsetY));
  return xMax - xMin > 0.01 && yMax - yMin > 0.01 ? { xMin, yMin, xMax, yMax } : null;
}

function getNativeFaceDetector() {
  if (nativeFaceDetector !== undefined) return nativeFaceDetector;
  const FaceDetectorClass = globalThis.FaceDetector;
  if (typeof FaceDetectorClass !== "function") {
    nativeFaceDetector = null;
    return nativeFaceDetector;
  }
  try {
    nativeFaceDetector = new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 5 });
  } catch {
    nativeFaceDetector = null;
  }
  return nativeFaceDetector;
}

async function detectNativeFace(source, width, height, subjectBox = null) {
  const detector = getNativeFaceDetector();
  if (!detector || !source) return null;
  try {
    const faces = await detector.detect(source);
    const candidates = faces.map((face) => {
      const box = face.boundingBox;
      if (!box) return null;
      const normalized = {
        xMin: Math.max(0, box.x / Math.max(1, width)),
        yMin: Math.max(0, box.y / Math.max(1, height)),
        xMax: Math.min(1, (box.x + box.width) / Math.max(1, width)),
        yMax: Math.min(1, (box.y + box.height) / Math.max(1, height)),
      };
      const centerX = (normalized.xMin + normalized.xMax) / 2;
      const centerY = (normalized.yMin + normalized.yMax) / 2;
      const insideSubject = subjectBox
        ? centerX >= Number(subjectBox.xmin ?? subjectBox.xMin)
          && centerX <= Number(subjectBox.xmax ?? subjectBox.xMax)
          && centerY >= Number(subjectBox.ymin ?? subjectBox.yMin) - 0.15
          && centerY <= Number(subjectBox.ymax ?? subjectBox.yMax)
        : true;
      const area = (normalized.xMax - normalized.xMin) * (normalized.yMax - normalized.yMin);
      return insideSubject ? { box: normalized, rank: area - Math.hypot(centerX - 0.5, centerY - 0.35) * 0.02 } : null;
    }).filter(Boolean).sort((left, right) => right.rank - left.rank);
    return candidates[0]?.box || null;
  } catch {
    return null;
  }
}

async function detectAnchor(blob, targetBox, signal, onProgress) {
  const result = await analyzeVisualSubject({
    blob,
    includeMatting: false,
    threshold: 0.24,
    preferredLabels: ["person", "cat", "dog", "car", "bottle", "chair"],
    targetBox,
    signal,
    onProgress,
  });
  const subject = result.subject || result.detectedSubject || null;
  return subject ? {
    ...subject,
    runtimeBackend: result.runtimeBackends?.detector || "unknown",
    runtimeFallbackReason: result.runtimeBackends?.detectorFallbackReason || "",
  } : null;
}

async function analyzeImage(segment, signal, onProgress) {
  onProgress?.({ stage: "setup", progress: 2, phase: "准备主体检测模型" });
  const source = segment?.blob || segment?.src;
  const blob = await captureVisualFrame({ src: source, type: "image", maxDimension: 1024, signal });
  const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : null;
  const sourceSize = {
    width: Math.max(1, Number(segment?.width) || bitmap?.width || 1),
    height: Math.max(1, Number(segment?.height) || bitmap?.height || 1),
  };
  const subject = await detectAnchor(blob, null, signal, ({ progress, phase }) => {
    onProgress?.({ stage: "setup", progress, phase });
  });
  if (!subject?.box) throw new Error("没有识别到可用于构图的主体");
  const face = await detectNativeFace(bitmap, bitmap?.width, bitmap?.height, subject.box);
  bitmap?.close?.();
  onProgress?.({ stage: "analysis", progress: 100, phase: "当前图片构图轨迹已生成" });
  return {
    sourceSize,
    modelRevision: YOLOS_TINY_MODEL_REVISION,
    runtimeBackend: subject.runtimeBackend || "unknown",
    samples: [{ time: 0, subject: { ...subject, face }, source: "detector", state: "tracked" }],
  };
}

async function analyzeVideo(segment, signal, onProgress, onSample) {
  const requestedSource = segment?.blob || segment?.src;
  if (!requestedSource) throw new Error("当前片段缺少视频源");
  const objectUrl = requestedSource instanceof Blob ? URL.createObjectURL(requestedSource) : "";
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl || String(requestedSource);
  try {
    await seekVideo(video, Math.max(0, Number(segment.sourceStart) || 0), signal);
    const sourceSize = { width: video.videoWidth, height: video.videoHeight };
    if (!sourceSize.width || !sourceSize.height) throw new Error("视频尺寸无效");
    const maxDimension = 360;
    const scale = Math.min(1, maxDimension / Math.max(sourceSize.width, sourceSize.height));
    const width = Math.max(8, Math.round(sourceSize.width * scale));
    const height = Math.max(8, Math.round(sourceSize.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("无法创建 Smart Frame 分析画布");

    const playbackRate = normalizeVisualPlaybackRate(segment.playbackRate);
    const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
    const sourceDuration = Math.max(0.05, Number(segment.sourceDuration) || Number(segment.duration) * playbackRate || 0.05);
    const sourceEnd = Math.min(Number(video.duration) || sourceStart + sourceDuration, sourceStart + sourceDuration);
    const fps = 4;
    const sampleCount = Math.max(2, Math.min(480, Math.ceil((sourceEnd - sourceStart) * fps) + 1));
    const times = Array.from({ length: sampleCount }, (_, index) => (
      index === sampleCount - 1 ? sourceEnd : sourceStart + index / fps
    ));
    const anchorEvery = Math.max(2, Math.round(fps * 2.5));
    const samples = [];
    let trackedSubject = null;
    let flowInitialized = false;
    let lastAnchorIndex = -anchorEvery;

    for (let index = 0; index < times.length; index += 1) {
      throwIfAborted(signal);
      const time = times[index];
      await seekVideo(video, time, signal);
      context.drawImage(video, 0, 0, width, height);
      let rgba = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
      let flowResult = null;
      if (flowInitialized && trackedSubject?.box) {
        flowResult = await requestFlow("step", { rgba: rgba.buffer, box: trackedSubject.box }, signal);
        trackedSubject = {
          ...trackedSubject,
          box: translateBox(trackedSubject.box, flowResult.dx, flowResult.dy, width, height),
          face: translateBox(trackedSubject.face, flowResult.dx, flowResult.dy, width, height),
        };
      }

      const sceneCut = Number(flowResult?.lumaDelta) > 34;
      const shouldDetect = index === 0 || sceneCut || !trackedSubject?.box || index - lastAnchorIndex >= anchorEvery;
      let source = "flow";
      if (shouldDetect) {
        lastAnchorIndex = index;
        const frameBlob = await canvasToBlob(canvas);
        const detected = await detectAnchor(frameBlob, sceneCut ? null : trackedSubject?.box, signal, ({ progress, phase }) => {
          const setup = index === 0;
          onProgress?.({
            stage: setup ? "setup" : "analysis",
            progress: setup ? progress : ((index + progress / 100) / times.length) * 100,
            phase: setup ? phase : `稀疏检测 ${Math.floor(index / anchorEvery) + 1} · ${phase}`,
          });
        });
        if (detected?.box) {
          const face = String(detected.label || "").toLowerCase() === "person"
            ? await detectNativeFace(canvas, width, height, detected.box)
            : null;
          trackedSubject = { ...detected, face };
        }
        else if (sceneCut) trackedSubject = null;
        source = "detector";
      }

      if (!flowInitialized) {
        rgba = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
        await requestFlow("init", { width, height, rgba: rgba.buffer }, signal);
        flowInitialized = true;
      }
      const sample = {
        time,
        subject: trackedSubject?.box ? trackedSubject : null,
        source,
        state: trackedSubject?.box ? "tracked" : "lost",
      };
      samples.push(sample);
      onSample?.({ sample, index, total: times.length });
      onProgress?.({
        stage: "analysis",
        progress: ((index + 1) / times.length) * 100,
        phase: trackedSubject?.box
          ? `${source === "detector" ? "稀疏检测" : "光流跟踪"} ${index + 1}/${times.length}`
          : `主体丢失 ${index + 1}/${times.length}`,
      });
    }
    if (!samples.some((sample) => sample.subject?.box)) throw new Error("没有识别到稳定主体");
    return {
      samples,
      sourceSize,
      modelRevision: YOLOS_TINY_MODEL_REVISION,
      runtimeBackend: samples.find((sample) => sample.subject?.runtimeBackend)?.subject.runtimeBackend || "unknown",
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function analyzeSmartFrameClip({ segment, signal, onProgress, onSample }) {
  if (!segment?.src && !segment?.blob) throw new Error("请先选择当前图片或视频片段");
  if (segment.type === "video") return analyzeVideo(segment, signal, onProgress, onSample);
  return analyzeImage(segment, signal, onProgress);
}

export function disposeSmartFrameAnalysis() {
  resetFlowWorker(new Error("Smart Frame 光流已释放"));
}

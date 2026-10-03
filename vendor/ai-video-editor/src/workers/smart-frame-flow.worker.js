/* global cv */

self.postMessage({ type: "status", phase: "正在读取光流运行时" });
importScripts("/vendor/opencv.js");

let runtime = null;
let width = 0;
let height = 0;
let previousGray = null;

function dispose() {
  previousGray?.delete();
  previousGray = null;
  width = 0;
  height = 0;
}

function rgbaToGray(buffer) {
  const rgba = new runtime.Mat(height, width, runtime.CV_8UC4);
  const gray = new runtime.Mat();
  rgba.data.set(new Uint8ClampedArray(buffer));
  runtime.cvtColor(rgba, gray, runtime.COLOR_RGBA2GRAY);
  rgba.delete();
  return gray;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function getRoi(box) {
  const xMin = clamp(box?.xMin ?? box?.xmin, 0, 1);
  const yMin = clamp(box?.yMin ?? box?.ymin, 0, 1);
  const xMax = clamp(box?.xMax ?? box?.xmax, 0, 1);
  const yMax = clamp(box?.yMax ?? box?.ymax, 0, 1);
  const padX = Math.max(8, (xMax - xMin) * width * 0.18);
  const padY = Math.max(8, (yMax - yMin) * height * 0.18);
  const x = Math.max(0, Math.floor(xMin * width - padX));
  const y = Math.max(0, Math.floor(yMin * height - padY));
  return {
    x,
    y,
    width: Math.max(8, Math.min(width - x, Math.ceil(xMax * width + padX) - x)),
    height: Math.max(8, Math.min(height - y, Math.ceil(yMax * height + padY) - y)),
  };
}

function median(values) {
  if (!values.length) return 0;
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function estimate(currentGray, box) {
  const roi = getRoi(box);
  const rect = new runtime.Rect(roi.x, roi.y, roi.width, roi.height);
  const previous = previousGray.roi(rect);
  const current = currentGray.roi(rect);
  const flow = new runtime.Mat();
  const channels = new runtime.MatVector();
  try {
    const previousLuma = Number(runtime.mean(previous)?.[0]) || 0;
    const currentLuma = Number(runtime.mean(current)?.[0]) || 0;
    runtime.calcOpticalFlowFarneback(previous, current, flow, 0.5, 2, 13, 2, 5, 1.2, 0);
    runtime.split(flow, channels);
    const flowX = channels.get(0);
    const flowY = channels.get(1);
    try {
      const xs = [];
      const ys = [];
      let motion = 0;
      let count = 0;
      for (let y = 1; y < roi.height - 1; y += 2) {
        for (let x = 1; x < roi.width - 1; x += 2) {
          const index = y * roi.width + x;
          const dx = flowX.data32F[index];
          const dy = flowY.data32F[index];
          const magnitude = Math.hypot(dx, dy);
          if (!Number.isFinite(magnitude) || magnitude > 32) continue;
          xs.push(dx);
          ys.push(dy);
          motion += magnitude;
          count += 1;
        }
      }
      return {
        dx: median(xs),
        dy: median(ys),
        meanMotion: motion / Math.max(1, count),
        lumaDelta: Math.abs(currentLuma - previousLuma),
        roi,
      };
    } finally {
      flowX.delete();
      flowY.delete();
    }
  } finally {
    channels.delete();
    flow.delete();
    previous.delete();
    current.delete();
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message?.requestId || !runtime) return;
  try {
    if (message.type === "init") {
      dispose();
      width = Math.max(8, Number(message.width) || 0);
      height = Math.max(8, Number(message.height) || 0);
      previousGray = rgbaToGray(message.rgba);
      self.postMessage({ requestId: message.requestId, type: "result", result: {} });
      return;
    }
    if (message.type === "step") {
      if (!previousGray) throw new Error("光流尚未初始化");
      const currentGray = rgbaToGray(message.rgba);
      const result = estimate(currentGray, message.box);
      previousGray.delete();
      previousGray = currentGray;
      self.postMessage({ requestId: message.requestId, type: "result", result });
      return;
    }
    if (message.type === "dispose") {
      dispose();
      self.postMessage({ requestId: message.requestId, type: "result", result: {} });
      return;
    }
    throw new Error(`未知光流指令：${message.type}`);
  } catch (error) {
    self.postMessage({ requestId: message.requestId, type: "error", error: error?.message || String(error) });
  }
});

(async () => {
  try {
    runtime = cv;
    if (!runtime?.Mat) {
      await new Promise((resolve) => {
        const previous = runtime.onRuntimeInitialized;
        runtime.onRuntimeInitialized = () => {
          previous?.();
          resolve();
        };
      });
    }
    if (!runtime?.Mat || !runtime?.calcOpticalFlowFarneback) throw new Error("当前 OpenCV.js 不支持 Farneback 光流");
    self.postMessage({ type: "ready", version: runtime.getVersionString?.() || "4.x" });
  } catch (error) {
    self.postMessage({ type: "fatal", error: error?.message || String(error) });
  }
})();

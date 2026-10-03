/* global cv */

self.postMessage({ type: "status", phase: "正在读取 OpenCV 光流运行时" });
importScripts("/vendor/opencv.js");

let runtime = null;
let width = 0;
let height = 0;
let previousGray = null;
let currentAlpha = null;

function disposeState() {
  previousGray?.delete();
  previousGray = null;
  currentAlpha = null;
  width = 0;
  height = 0;
}

function rgbaToGray(rgbaBytes) {
  const rgba = new runtime.Mat(height, width, runtime.CV_8UC4);
  const gray = new runtime.Mat();
  rgba.data.set(rgbaBytes);
  runtime.cvtColor(rgba, gray, runtime.COLOR_RGBA2GRAY);
  rgba.delete();
  return gray;
}

function getAlphaRoi(alpha) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (alpha[row + x] < 48) continue;
      foreground += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!foreground) return { x: 0, y: 0, width, height, fallback: true };
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const padX = Math.max(12, Math.round(boxWidth * 0.20));
  const padY = Math.max(12, Math.round(boxHeight * 0.20));
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  return {
    x,
    y,
    width: Math.max(2, Math.min(width, maxX + 1 + padX) - x),
    height: Math.max(2, Math.min(height, maxY + 1 + padY) - y),
    fallback: false,
  };
}

function propagateAlpha(currentGray) {
  const roi = getAlphaRoi(currentAlpha);
  const rect = new runtime.Rect(roi.x, roi.y, roi.width, roi.height);
  const currentGrayRoi = currentGray.roi(rect);
  const previousGrayRoi = previousGray.roi(rect);
  const flow = new runtime.Mat();
  const flowChannels = new runtime.MatVector();
  const mapX = new runtime.Mat(roi.height, roi.width, runtime.CV_32FC1);
  const mapY = new runtime.Mat(roi.height, roi.width, runtime.CV_32FC1);
  const previousMask = new runtime.Mat(height, width, runtime.CV_8UC1);
  previousMask.data.set(currentAlpha);
  const previousMaskRoi = previousMask.roi(rect);
  const warpedMask = new runtime.Mat();
  try {
    const currentMeanLuma = Number(runtime.mean(currentGrayRoi)?.[0]) || 0;
    const previousMeanLuma = Number(runtime.mean(previousGrayRoi)?.[0]) || 0;
    const meanLumaDelta = Math.abs(currentMeanLuma - previousMeanLuma);
    runtime.calcOpticalFlowFarneback(
      currentGrayRoi, previousGrayRoi, flow,
      0.5, 2, 13, 2, 5, 1.2, 0,
    );
    runtime.split(flow, flowChannels);
    const flowX = flowChannels.get(0);
    const flowY = flowChannels.get(1);
    try {
      let motionTotal = 0;
      let motionMaximum = 0;
      for (let y = 0; y < roi.height; y += 1) {
        const row = y * roi.width;
        for (let x = 0; x < roi.width; x += 1) {
          const flowIndex = row + x;
          const deltaX = flowX.data32F[flowIndex];
          const deltaY = flowY.data32F[flowIndex];
          const magnitude = Math.hypot(deltaX, deltaY);
          motionTotal += magnitude;
          motionMaximum = Math.max(motionMaximum, magnitude);
          mapX.data32F[flowIndex] = x + deltaX;
          mapY.data32F[flowIndex] = y + deltaY;
        }
      }
      runtime.remap(
        previousMaskRoi, warpedMask, mapX, mapY,
        runtime.INTER_LINEAR, runtime.BORDER_CONSTANT, new runtime.Scalar(0),
      );
      const alpha = new Uint8ClampedArray(width * height);
      for (let y = 0; y < roi.height; y += 1) {
        alpha.set(
          warpedMask.data.subarray(y * roi.width, (y + 1) * roi.width),
          (roi.y + y) * width + roi.x,
        );
      }
      return {
        alpha,
        roi,
        meanMotion: motionTotal / Math.max(1, roi.width * roi.height),
        maxMotion: motionMaximum,
        meanLumaDelta,
      };
    } finally {
      flowX.delete();
      flowY.delete();
    }
  } finally {
    flowChannels.delete();
    flow.delete();
    currentGrayRoi.delete();
    previousGrayRoi.delete();
    mapX.delete();
    mapY.delete();
    previousMaskRoi.delete();
    previousMask.delete();
    warpedMask.delete();
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message?.requestId || !runtime) return;
  try {
    if (message.type === "init") {
      const rgbaBuffer = message.rgba;
      disposeState();
      width = Math.max(2, Number(message.width) || 0);
      height = Math.max(2, Number(message.height) || 0);
      currentAlpha = new Uint8ClampedArray(message.alpha);
      previousGray = rgbaToGray(new Uint8ClampedArray(rgbaBuffer));
      self.postMessage({
        requestId: message.requestId,
        type: "result",
        result: { rgba: rgbaBuffer },
      }, [rgbaBuffer]);
      return;
    }
    if (message.type === "step") {
      if (!previousGray || !currentAlpha) throw new Error("光流状态尚未初始化");
      const started = performance.now();
      const rgbaBuffer = message.rgba;
      const currentGray = rgbaToGray(new Uint8ClampedArray(rgbaBuffer));
      const propagated = propagateAlpha(currentGray);
      previousGray.delete();
      previousGray = currentGray;
      currentAlpha = propagated.alpha;
      const transferableAlpha = new Uint8ClampedArray(propagated.alpha);
      self.postMessage({
        requestId: message.requestId,
        type: "result",
        result: {
          alpha: transferableAlpha.buffer,
          durationMs: performance.now() - started,
          roi: propagated.roi,
          meanMotion: propagated.meanMotion,
          maxMotion: propagated.maxMotion,
          rgba: rgbaBuffer,
        },
      }, [transferableAlpha.buffer, rgbaBuffer]);
      return;
    }
    if (message.type === "resetAlpha") {
      currentAlpha = new Uint8ClampedArray(message.alpha);
      self.postMessage({ requestId: message.requestId, type: "result", result: {} });
      return;
    }
    if (message.type === "dispose") {
      disposeState();
      self.postMessage({ requestId: message.requestId, type: "result", result: {} });
      return;
    }
    throw new Error(`未知光流指令：${message.type}`);
  } catch (error) {
    self.postMessage({
      requestId: message.requestId,
      type: "error",
      error: error?.message || String(error),
    });
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
    if (!runtime?.Mat || !runtime?.calcOpticalFlowFarneback) {
      throw new Error("当前 OpenCV.js 构建不包含 Farneback 光流");
    }
    self.postMessage({ type: "ready", version: runtime.getVersionString?.() ?? "4.x" });
  } catch (error) {
    self.postMessage({ type: "fatal", error: error?.message || String(error) });
  }
})();

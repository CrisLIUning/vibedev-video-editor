import { detectObjectsWithNanoDet } from "./objectSegmentation.js";
import { analyzeVisualSubject } from "./vision.js";
import { segmentMediaPipePerson } from "./mediapipePersonSegmentation.js";

const DEFAULT_WIDTH = 192;
const DEFAULT_SAMPLE_RATE = 6;
const DEFAULT_MAX_FRAMES = 42;

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException("Optical-flow analysis canceled", "AbortError");
}

function waitForEvent(target, eventName, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, handleEvent);
      target.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("The selected video frame could not be decoded."));
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("Optical-flow analysis canceled", "AbortError"));
    };
    target.addEventListener(eventName, handleEvent, { once: true });
    target.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function toGray(imageData) {
  const gray = new Uint8Array(imageData.width * imageData.height);
  const source = imageData.data;
  for (let index = 0, pixel = 0; index < source.length; index += 4, pixel += 1) {
    gray[pixel] = Math.round(source[index] * 0.299 + source[index + 1] * 0.587 + source[index + 2] * 0.114);
  }
  return gray;
}

function patchDifference(previous, current, width, x, y, dx, dy, radius) {
  let difference = 0;
  let samples = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const previousRow = (y + offsetY) * width;
    const currentRow = (y + dy + offsetY) * width;
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      difference += Math.abs(
        previous[previousRow + x + offsetX]
        - current[currentRow + x + dx + offsetX],
      );
      samples += 1;
    }
  }
  return difference / Math.max(1, samples);
}

function patchTexture(gray, width, x, y, radius) {
  let sum = 0;
  let squared = 0;
  let samples = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const row = (y + offsetY) * width;
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const value = gray[row + x + offsetX];
      sum += value;
      squared += value * value;
      samples += 1;
    }
  }
  const mean = sum / Math.max(1, samples);
  return squared / Math.max(1, samples) - mean * mean;
}

export function calculateBlockFlow(previous, current, width, height, {
  gridStep = 16,
  patchRadius = 3,
  searchRadius = 5,
} = {}) {
  const vectors = [];
  const boundary = patchRadius + searchRadius + 1;
  for (let y = boundary; y < height - boundary; y += gridStep) {
    for (let x = boundary; x < width - boundary; x += gridStep) {
      const texture = patchTexture(previous, width, x, y, patchRadius);
      if (texture < 34) continue;
      const stationaryError = patchDifference(previous, current, width, x, y, 0, 0, patchRadius);
      let bestError = stationaryError;
      let bestX = 0;
      let bestY = 0;
      for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
          if (!dx && !dy) continue;
          const error = patchDifference(previous, current, width, x, y, dx, dy, patchRadius);
          if (error < bestError) {
            bestError = error;
            bestX = dx;
            bestY = dy;
          }
        }
      }
      const magnitude = Math.hypot(bestX, bestY);
      const confidence = stationaryError > 0
        ? Math.max(0, Math.min(1, (stationaryError - bestError) / stationaryError))
        : 0;
      if (magnitude >= 0.9 && confidence >= 0.08) {
        vectors.push({
          x,
          y,
          dx: bestX,
          dy: bestY,
          magnitude,
          confidence,
        });
      }
    }
  }
  return vectors;
}

function detectionArea(detection) {
  const box = detection?.box;
  return Math.max(0, Number(box?.xmax) - Number(box?.xmin))
    * Math.max(0, Number(box?.ymax) - Number(box?.ymin));
}

function detectionCenter(detection) {
  return {
    x: (Number(detection.box.xmin) + Number(detection.box.xmax)) / 2,
    y: (Number(detection.box.ymin) + Number(detection.box.ymax)) / 2,
  };
}

function mergeDetectionBucket(bucket, index) {
  const box = bucket.reduce((merged, detection) => ({
    xmin: Math.min(merged.xmin, Number(detection.box.xmin)),
    ymin: Math.min(merged.ymin, Number(detection.box.ymin)),
    xmax: Math.max(merged.xmax, Number(detection.box.xmax)),
    ymax: Math.max(merged.ymax, Number(detection.box.ymax)),
  }), { xmin: 1, ymin: 1, xmax: 0, ymax: 0 });
  const paddingX = Math.max(0.015, (box.xmax - box.xmin) * 0.08);
  const paddingY = Math.max(0.02, (box.ymax - box.ymin) * 0.08);
  return {
    id: `semantic-cohort-${index + 1}`,
    label: bucket.every((item) => item.label === "person") ? "person" : bucket[0]?.label || "object",
    members: bucket.length,
    score: bucket.reduce((total, item) => total + Number(item.score || 0), 0) / Math.max(1, bucket.length),
    box: {
      xmin: Math.max(0, box.xmin - paddingX),
      ymin: Math.max(0, box.ymin - paddingY),
      xmax: Math.min(1, box.xmax + paddingX),
      ymax: Math.min(1, box.ymax + paddingY),
    },
    dx: 0,
    dy: 0,
    confidence: 1,
  };
}

function clusterDetectionsByPosition(detections, clusterCount) {
  if (clusterCount <= 1) return [detections];
  const sorted = [...detections].sort((left, right) => detectionCenter(left).x - detectionCenter(right).x);
  let centers = Array.from({ length: clusterCount }, (_, index) => {
    const detection = sorted[Math.min(sorted.length - 1, Math.floor((index + 0.5) * sorted.length / clusterCount))];
    return detectionCenter(detection);
  });
  let buckets = [];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    buckets = Array.from({ length: clusterCount }, () => []);
    sorted.forEach((detection) => {
      const center = detectionCenter(detection);
      let closestIndex = 0;
      let closestDistance = Infinity;
      centers.forEach((candidate, index) => {
        const distance = Math.hypot((center.x - candidate.x) * 1.2, center.y - candidate.y);
        if (distance < closestDistance) {
          closestIndex = index;
          closestDistance = distance;
        }
      });
      buckets[closestIndex].push(detection);
    });
    centers = buckets.map((bucket, index) => {
      if (!bucket.length) return centers[index];
      const totalWeight = bucket.reduce((total, item) => total + Math.max(0.05, Number(item.score) || 0), 0);
      return bucket.reduce((center, detection) => {
        const weight = Math.max(0.05, Number(detection.score) || 0) / totalWeight;
        const itemCenter = detectionCenter(detection);
        return { x: center.x + itemCenter.x * weight, y: center.y + itemCenter.y * weight };
      }, { x: 0, y: 0 });
    });
  }
  return buckets.filter((bucket) => bucket.length);
}

export function buildSemanticCohorts(detections = []) {
  const candidates = detections
    .filter((detection) => {
      if (!detection?.box) return false;
      const score = Number(detection.score) || 0;
      return String(detection.label).toLowerCase() === "person"
        ? score >= 0.06
        : score >= 0.12;
    })
    .filter((detection) => {
      const area = detectionArea(detection);
      const maximumArea = String(detection.label).toLowerCase() === "person" ? 0.96 : 0.82;
      return area >= 0.004 && area <= maximumArea;
    })
    .sort((left, right) => (Number(right.score) + detectionArea(right) * 0.8)
      - (Number(left.score) + detectionArea(left) * 0.8))
    .slice(0, 18);
  const people = candidates.filter((detection) => String(detection.label).toLowerCase() === "person");
  if (people.length) {
    const clusterCount = people.length >= 7 ? 3 : people.length >= 3 ? 2 : people.length;
    return clusterDetectionsByPosition(people, Math.min(3, clusterCount))
      .map(mergeDetectionBucket)
      .sort((left, right) => right.members - left.members);
  }
  return candidates
    .filter((detection) => String(detection.label).toLowerCase() !== "person")
    .slice(0, 4)
    .map((detection, index) => mergeDetectionBucket([detection], index));
}

function personDetectionFromAlpha(alpha, width, height) {
  let maximum = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    maximum = Math.max(maximum, alpha[index]);
  }
  if (maximum <= 0) return null;
  let cutoff = Math.max(1, maximum * 0.42);
  const scan = () => {
    let scanXmin = width;
    let scanYmin = height;
    let scanXmax = -1;
    let scanYmax = -1;
    let scanPixels = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] < cutoff) continue;
        scanXmin = Math.min(scanXmin, x);
        scanYmin = Math.min(scanYmin, y);
        scanXmax = Math.max(scanXmax, x);
        scanYmax = Math.max(scanYmax, y);
        scanPixels += 1;
      }
    }
    return {
      xmin: scanXmin,
      ymin: scanYmin,
      xmax: scanXmax,
      ymax: scanYmax,
      pixels: scanPixels,
      coverage: scanPixels / Math.max(1, width * height),
    };
  };
  let scanned = scan();
  if (scanned.coverage > 0.98) {
    cutoff = Math.max(cutoff, maximum * 0.72);
    scanned = scan();
  }
  const {
    xmin,
    ymin,
    xmax,
    ymax,
    pixels,
    coverage,
  } = scanned;
  if (!pixels || xmax < xmin || ymax < ymin) return null;
  const paddingX = Math.max(2, (xmax - xmin + 1) * 0.06);
  const paddingY = Math.max(2, (ymax - ymin + 1) * 0.06);
  return {
    label: "person",
    score: Math.max(0.18, Math.min(0.92, 0.55 + coverage * 0.8)),
    box: {
      xmin: Math.max(0, (xmin - paddingX) / width),
      ymin: Math.max(0, (ymin - paddingY) / height),
      xmax: Math.min(1, (xmax + 1 + paddingX) / width),
      ymax: Math.min(1, (ymax + 1 + paddingY) / height),
    },
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => window.clearTimeout(timeoutId));
}

async function detectSemanticAnchor(frameBlob, frameSource, signal, onProgress) {
  let nanoDetResult = null;
  try {
    nanoDetResult = await withTimeout(
      detectObjectsWithNanoDet({
        blob: frameBlob,
        signal,
        scoreThreshold: 0.08,
        onProgress,
      }),
      6_000,
      "NANODET_ANCHOR_TIMEOUT",
    );
    const cohorts = buildSemanticCohorts(nanoDetResult.detections);
    if (cohorts.length) return { cohorts, detector: nanoDetResult };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("NanoDet optical-flow anchor detection failed; trying MediaPipe.", error);
  }

  try {
    abortIfNeeded(signal);
    onProgress?.({ progress: 58, phase: "MediaPipe person anchor" });
    const mediaPipeResult = await segmentMediaPipePerson(frameSource, { delegate: "CPU" });
    abortIfNeeded(signal);
    const detection = personDetectionFromAlpha(
      mediaPipeResult.alpha,
      mediaPipeResult.width,
      mediaPipeResult.height,
    ) || {
      label: "person",
      score: 0.18,
      box: {
        xmin: 0.06,
        ymin: 0.04,
        xmax: 0.94,
        ymax: 0.98,
      },
    };
    const cohorts = buildSemanticCohorts([detection]);
    if (cohorts.length) {
      return {
        cohorts,
        detector: {
          detections: [detection],
          modelId: mediaPipeResult.modelId,
          inferenceMs: mediaPipeResult.inferenceMs,
        },
      };
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("MediaPipe optical-flow anchor fallback failed; trying YOLOS.", error);
  }

  try {
    const yolosResult = await withTimeout(
      analyzeVisualSubject({
        blob: frameBlob,
        includeMatting: false,
        threshold: 0.1,
        preferredLabels: ["person"],
        signal,
        onProgress,
      }),
      6_000,
      "YOLOS_ANCHOR_TIMEOUT",
    );
    const detections = (yolosResult.detections || []).filter(
      (detection) => String(detection.label).toLowerCase() === "person",
    );
    const cohorts = buildSemanticCohorts(detections);
    if (cohorts.length) {
      return {
        cohorts,
        detector: {
          ...yolosResult,
          detections,
          modelId: yolosResult.modelIds?.detector || "YOLOS Tiny",
        },
      };
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("YOLOS optical-flow anchor fallback failed.", error);
  }

  const priorDetection = {
    label: "person",
    score: 0.18,
    box: {
      xmin: 0.06,
      ymin: 0.04,
      xmax: 0.94,
      ymax: 0.98,
    },
  };
  return {
    cohorts: buildSemanticCohorts([priorDetection]),
    detector: {
      ...(nanoDetResult || {}),
      detections: [priorDetection],
      modelId: "Semantic person prior",
    },
  };
}

function clampBox(box) {
  const width = Math.max(0.02, box.xmax - box.xmin);
  const height = Math.max(0.02, box.ymax - box.ymin);
  const xmin = Math.max(0, Math.min(1 - width, box.xmin));
  const ymin = Math.max(0, Math.min(1 - height, box.ymin));
  return { xmin, ymin, xmax: xmin + width, ymax: ymin + height };
}

function updateSemanticCohorts(cohorts, vectors, width, height, frameIndex, previousTracks) {
  const nextCohorts = cohorts.map((cohort) => {
    const box = cohort.box;
    const localVectors = vectors
      .filter((vector) => (
        vector.x / width >= box.xmin
        && vector.x / width <= box.xmax
        && vector.y / height >= box.ymin
        && vector.y / height <= box.ymax
      ))
      .sort((left, right) => left.magnitude - right.magnitude);
    const trimmed = localVectors.slice(0, Math.max(1, Math.ceil(localVectors.length * 0.84)));
    const weight = trimmed.reduce((total, vector) => total + vector.confidence, 0);
    const dx = weight > 0
      ? trimmed.reduce((total, vector) => total + vector.dx * vector.confidence, 0) / weight
      : 0;
    const dy = weight > 0
      ? trimmed.reduce((total, vector) => total + vector.dy * vector.confidence, 0) / weight
      : 0;
    const nextBox = clampBox({
      xmin: box.xmin + dx / width,
      ymin: box.ymin + dy / height,
      xmax: box.xmax + dx / width,
      ymax: box.ymax + dy / height,
    });
    return {
      ...cohort,
      box: nextBox,
      dx,
      dy,
      vectorCount: localVectors.length,
      confidence: Math.min(1, localVectors.length / 12),
      x: ((nextBox.xmin + nextBox.xmax) / 2) * width,
      y: ((nextBox.ymin + nextBox.ymax) / 2) * height,
    };
  });
  const tracks = nextCohorts.map((cohort) => {
    const previous = previousTracks.find((track) => track.id === cohort.id);
    return {
      id: cohort.id,
      label: cohort.label,
      members: cohort.members,
      points: [
        ...(previous?.points || []),
        {
          x: cohort.x,
          y: cohort.y,
          dx: cohort.dx,
          dy: cohort.dy,
          confidence: cohort.confidence,
          frameIndex,
        },
      ].slice(-18),
    };
  });
  return { cohorts: nextCohorts, tracks };
}

function summarize(frames, trajectories) {
  const cohortSamples = frames.flatMap((frame) => frame.cohorts || []);
  const weight = cohortSamples.reduce(
    (total, cohort) => total + Math.max(1, Number(cohort.vectorCount) || 0) * Math.max(0.1, Number(cohort.confidence) || 0),
    0,
  ) || 1;
  const dx = cohortSamples.reduce((total, cohort) => {
    const sampleWeight = Math.max(1, Number(cohort.vectorCount) || 0) * Math.max(0.1, Number(cohort.confidence) || 0);
    return total + cohort.dx * sampleWeight;
  }, 0) / weight;
  const dy = cohortSamples.reduce((total, cohort) => {
    const sampleWeight = Math.max(1, Number(cohort.vectorCount) || 0) * Math.max(0.1, Number(cohort.confidence) || 0);
    return total + cohort.dy * sampleWeight;
  }, 0) / weight;
  const dominantAngle = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360);
  const magnitudes = cohortSamples.map((cohort) => Math.hypot(cohort.dx, cohort.dy));
  const mean = magnitudes.reduce((total, value) => total + value, 0) / Math.max(1, magnitudes.length);
  const deviation = Math.sqrt(
    magnitudes.reduce((total, value) => total + (value - mean) ** 2, 0)
    / Math.max(1, magnitudes.length),
  );
  const stability = Math.round(Math.max(0, Math.min(100, 100 - deviation / Math.max(0.5, mean) * 36)));
  return {
    vectorCount: Math.round(cohortSamples.reduce((total, cohort) => total + (Number(cohort.vectorCount) || 0), 0)),
    cohortCount: trajectories.length,
    dominantAngle,
    stability,
  };
}

export async function analyzeOpticalFlowVideo({
  src,
  sourceStart = 0,
  duration = 0,
  playbackRate = 1,
  sampleRate = DEFAULT_SAMPLE_RATE,
  maxFrames = DEFAULT_MAX_FRAMES,
  analysisWidth = DEFAULT_WIDTH,
  signal,
  onProgress,
}) {
  if (!src) throw new Error("No video source is available for optical-flow analysis.");
  abortIfNeeded(signal);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  video.load();
  if (video.readyState < 1) await waitForEvent(video, "loadedmetadata", signal);
  abortIfNeeded(signal);

  const sourceDuration = Number.isFinite(video.duration) ? video.duration : 0;
  const safeStart = Math.max(0, Math.min(sourceDuration, Number(sourceStart) || 0));
  const requestedSourceDuration = Math.max(0.2, (Number(duration) || sourceDuration || 1) * Math.max(0.25, Number(playbackRate) || 1));
  const safeEnd = Math.max(safeStart + 0.05, Math.min(sourceDuration || safeStart + requestedSourceDuration, safeStart + requestedSourceDuration));
  const sampleCount = Math.max(3, Math.min(
    maxFrames,
    Math.floor((safeEnd - safeStart) * Math.max(2, Number(sampleRate) || DEFAULT_SAMPLE_RATE)) + 1,
  ));
  const width = Math.max(128, Math.round(analysisWidth));
  const height = Math.max(72, Math.round(width / Math.max(0.5, video.videoWidth / Math.max(1, video.videoHeight))));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const renderWidth = Math.max(width, Math.min(1280, Number(video.videoWidth) || width));
  const renderHeight = Math.max(height, Math.round(renderWidth * (Number(video.videoHeight) || height) / Math.max(1, Number(video.videoWidth) || width)));
  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = renderWidth;
  renderCanvas.height = renderHeight;
  const renderContext = renderCanvas.getContext("2d", { alpha: false });
  if (!renderContext) throw new Error("The optical-flow render canvas could not be created.");
  const frames = [];
  let previousGray = null;
  let trajectories = [];
  let semanticCohorts = [];
  let detector = null;

  for (let index = 0; index < sampleCount; index += 1) {
    abortIfNeeded(signal);
    const progress = sampleCount <= 1 ? 1 : index / (sampleCount - 1);
    const time = safeStart + (safeEnd - safeStart) * progress;
    if (Math.abs(video.currentTime - time) > 0.001) {
      video.currentTime = time;
      await waitForEvent(video, "seeked", signal);
    }
    abortIfNeeded(signal);
    context.drawImage(video, 0, 0, width, height);
    renderContext.drawImage(video, 0, 0, renderWidth, renderHeight);
    const imageData = context.getImageData(0, 0, width, height);
    const gray = toGray(imageData);
    if (index === 0) {
      const frameBlob = await new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("The semantic anchor frame could not be encoded.")),
        "image/jpeg",
        0.9,
      ));
      onProgress?.({ progress: 3, frame: 0, total: sampleCount, phase: "detecting" });
      const anchor = await detectSemanticAnchor(frameBlob, canvas, signal, (next) => {
        onProgress?.({
          progress: Math.max(3, Math.min(18, Math.round((Number(next.progress) || 0) * 0.18))),
          frame: 0,
          total: sampleCount,
          phase: "detecting",
        });
      });
      detector = anchor.detector;
      semanticCohorts = anchor.cohorts;
      if (!semanticCohorts.length) {
        throw new Error("NO_SEMANTIC_MOTION_COHORT");
      }
    }
    const vectors = previousGray
      ? calculateBlockFlow(previousGray, gray, width, height)
      : [];
    const updated = updateSemanticCohorts(semanticCohorts, vectors, width, height, index, trajectories);
    semanticCohorts = updated.cohorts;
    trajectories = updated.tracks;
    frames.push({
      time: Math.max(0, (time - safeStart) / Math.max(0.25, Number(playbackRate) || 1)),
      image: renderCanvas.toDataURL("image/jpeg", 0.9),
      vectors,
      cohorts: semanticCohorts.map((cohort) => ({ ...cohort, box: { ...cohort.box } })),
      trajectories: trajectories.map((track) => ({
        ...track,
        points: track.points.map((point) => ({ ...point })),
      })),
    });
    previousGray = gray;
    onProgress?.({
      progress: Math.round(18 + ((index + 1) / sampleCount) * 82),
      frame: index + 1,
      total: sampleCount,
      phase: index < 2 ? "decoding" : index < sampleCount - 2 ? "flow" : "trajectories",
    });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  video.pause();
  video.removeAttribute("src");
  video.load();
  return {
    width,
    height,
    renderWidth,
    renderHeight,
    duration: Math.max(0, (safeEnd - safeStart) / Math.max(0.25, Number(playbackRate) || 1)),
    sampleRate,
    detector: {
      modelId: detector?.modelId || "NanoDet-Plus-m-320",
      detections: detector?.detections?.length || 0,
    },
    frames,
    trajectories,
    summary: summarize(frames, trajectories),
  };
}

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

export const SMART_FRAME_VERSION = 2;
export const SMART_FRAME_MOTIONS = Object.freeze({
  locked: { smoothing: 0.12, tolerance: 0.018 },
  smooth: { smoothing: 0.24, tolerance: 0.011 },
  responsive: { smoothing: 0.46, tolerance: 0.006 },
});

function normalizeBox(box) {
  if (!box) return null;
  const xMin = clamp(box.xMin ?? box.xmin);
  const yMin = clamp(box.yMin ?? box.ymin);
  const xMax = clamp(box.xMax ?? box.xmax);
  const yMax = clamp(box.yMax ?? box.ymax);
  if (xMax - xMin < 0.01 || yMax - yMin < 0.01) return null;
  return { xMin, yMin, xMax, yMax };
}

function normalizeSubject(subject) {
  const box = normalizeBox(subject?.box ?? subject);
  if (!box) return null;
  return {
    box,
    face: normalizeBox(subject?.face?.box ?? subject?.face),
    label: String(subject?.label || "object").toLowerCase(),
    score: clamp(subject?.score ?? 0),
  };
}

function inferHeadBox(subject) {
  if (!subject?.box || subject.label !== "person") return null;
  const box = subject.box;
  const width = box.xMax - box.xMin;
  const height = box.yMax - box.yMin;
  const centerX = (box.xMin + box.xMax) / 2;
  const headWidth = Math.max(width * 0.5, height * 0.18);
  return normalizeBox({
    xMin: centerX - headWidth / 2,
    xMax: centerX + headWidth / 2,
    yMin: box.yMin - height * 0.42,
    yMax: box.yMin + height * 0.28,
  });
}

function getCompositionGuide(subjectInput) {
  const subject = normalizeSubject(subjectInput);
  if (!subject) return null;
  const head = subject.face || inferHeadBox(subject);
  const focus = head || subject.box;
  return {
    subject,
    head,
    focusX: (focus.xMin + focus.xMax) / 2,
    focusY: (focus.yMin + focus.yMax) / 2,
  };
}

function normalizeCrop(crop) {
  if (!crop) return null;
  const width = clamp(crop.width, 0.01, 1);
  const height = clamp(crop.height, 0.01, 1);
  return {
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
  };
}

function getLargestCrop(sourceSize, targetSize) {
  const sourceAspect = Math.max(0.01, Number(sourceSize?.width) || 1) / Math.max(0.01, Number(sourceSize?.height) || 1);
  const targetAspect = Math.max(0.01, Number(targetSize?.width) || 1) / Math.max(0.01, Number(targetSize?.height) || 1);
  const normalizedAspect = targetAspect / sourceAspect;
  if (normalizedAspect <= 1) return { width: normalizedAspect, height: 1 };
  return { width: 1, height: 1 / normalizedAspect };
}

function needsSmartStage(sourceSize, targetSize, subjectInput) {
  const guide = getCompositionGuide(subjectInput);
  if (!guide?.head || guide.subject.label !== "person") return false;
  const largest = getLargestCrop(sourceSize, targetSize);
  const headWidth = guide.head.xMax - guide.head.xMin;
  const headHeight = guide.head.yMax - guide.head.yMin;
  const subjectHeight = guide.subject.box.yMax - guide.subject.box.yMin;
  // Head estimates from a body detector do not include every hairstyle or piece
  // of headwear. Protect the complete person too when a wide target discards so
  // much source height that a subject-filling shot cannot be composed safely.
  const fullPersonNeedsStage = largest.height < 0.75 && subjectHeight > largest.height * 0.94;
  return fullPersonNeedsStage
    || headWidth > largest.width * 0.88
    || headHeight > largest.height * 0.6;
}

export function solveSmartFrameCrop(sourceSize, targetSize, subjectBox, options = {}) {
  const guide = getCompositionGuide(subjectBox);
  const subject = guide?.subject.box;
  const largest = getLargestCrop(sourceSize, targetSize);
  if (!subject) return { x: (1 - largest.width) / 2, y: (1 - largest.height) / 2, ...largest };

  const padding = clamp(options.padding ?? 0.16, 0.04, 0.4);
  const requestedMaxZoom = Math.max(1, Math.min(2, Number(options.maxZoom) || 1.45));
  const normalizedAspect = largest.width / largest.height;
  const subjectWidth = subject.xMax - subject.xMin;
  const subjectHeight = subject.yMax - subject.yMin;
  const headHeight = guide.head ? guide.head.yMax - guide.head.yMin : 0;
  const shot = headHeight > 0.3
    ? "close"
    : subjectHeight >= 0.68 ? "full" : subjectHeight >= 0.38 ? "medium" : "wide";
  const desiredHeightOccupancy = shot === "close" ? 0.78 : shot === "full" ? 0.86 : shot === "medium" ? 0.72 : 0.62;
  const desiredWidthOccupancy = shot === "close" ? 0.72 : 0.78;
  const paddedHeightOccupancy = Math.max(0.48, desiredHeightOccupancy - padding * 0.22);
  const paddedWidthOccupancy = Math.max(0.5, desiredWidthOccupancy - padding * 0.18);
  const shotZoomLimit = shot === "close" ? 1.08 : shot === "full" ? 1.2 : shot === "medium" ? 1.35 : 1.55;
  const maxZoom = Math.min(requestedMaxZoom, shotZoomLimit);
  let height = Math.max(
    largest.height / maxZoom,
    subjectHeight / paddedHeightOccupancy,
    (subjectWidth / paddedWidthOccupancy) / normalizedAspect,
  );
  let width = height * normalizedAspect;
  if (width > largest.width || height > largest.height) {
    width = largest.width;
    height = largest.height;
  }

  const crop = normalizeCrop({
    x: guide.focusX - width / 2 + (Number(options.leadX) || 0),
    // Anchor a person shot from the protected head top. Centering the face is
    // visually tempting but clips hair/headwear in square and portrait outputs.
    y: guide.head ? guide.head.yMin - height * 0.055 : guide.focusY - height / 2,
    width,
    height,
  });
  return keepSubjectInside(crop, guide.subject);
}

function keepSubjectInside(crop, subjectBox, margin = 0.08) {
  const guide = getCompositionGuide(subjectBox);
  const subject = guide?.subject.box;
  if (!guide || !subject) return crop;
  const next = { ...crop };
  const subjectWidth = subject.xMax - subject.xMin;
  const subjectHeight = subject.yMax - subject.yMin;
  const marginX = next.width * margin;
  const marginY = next.height * margin;

  if (subjectWidth + marginX * 2 <= next.width) {
    if (subject.xMin < next.x + marginX) next.x = subject.xMin - marginX;
    if (subject.xMax > next.x + next.width - marginX) next.x = subject.xMax - next.width + marginX;
  } else {
    next.x = guide.focusX - next.width / 2;
  }

  if (subjectHeight + marginY * 2 <= next.height) {
    if (subject.yMin < next.y + marginY) next.y = subject.yMin - marginY;
    if (subject.yMax > next.y + next.height - marginY) next.y = subject.yMax - next.height + marginY;
  }

  const protectedHead = guide.head;
  if (protectedHead) {
    const headMarginX = Math.min(next.width * 0.08, Math.max(0, (next.width - (protectedHead.xMax - protectedHead.xMin)) / 2));
    const headMarginY = Math.min(next.height * 0.08, Math.max(0, (next.height - (protectedHead.yMax - protectedHead.yMin)) / 2));
    const headWidth = protectedHead.xMax - protectedHead.xMin;
    const headHeight = protectedHead.yMax - protectedHead.yMin;
    if (headWidth + headMarginX * 2 <= next.width) {
      if (protectedHead.xMin < next.x + headMarginX) next.x = protectedHead.xMin - headMarginX;
      if (protectedHead.xMax > next.x + next.width - headMarginX) next.x = protectedHead.xMax - next.width + headMarginX;
    } else {
      next.x = guide.focusX - next.width / 2;
    }
    if (headHeight + headMarginY * 2 <= next.height) {
      if (protectedHead.yMin < next.y + headMarginY) next.y = protectedHead.yMin - headMarginY;
      if (protectedHead.yMax > next.y + next.height - headMarginY) next.y = protectedHead.yMax - next.height + headMarginY;
    } else {
      next.y = protectedHead.yMin - next.height * 0.055;
    }
  }
  return normalizeCrop(next);
}

function smoothPass(frames, amount, reverse = false) {
  const output = frames.map((frame) => ({ ...frame, crop: { ...frame.crop } }));
  const indexes = reverse
    ? Array.from({ length: output.length - 1 }, (_, index) => output.length - 2 - index)
    : Array.from({ length: output.length - 1 }, (_, index) => index + 1);
  indexes.forEach((index) => {
    const previous = output[index + (reverse ? 1 : -1)];
    const current = output[index];
    const deadX = previous.crop.width * 0.025;
    const deadY = previous.crop.height * 0.025;
    ["x", "y", "width", "height"].forEach((key) => {
      const delta = current.crop[key] - previous.crop[key];
      const dead = key === "x" ? deadX : key === "y" ? deadY : 0.002;
      current.crop[key] = previous.crop[key] + (Math.abs(delta) <= dead ? 0 : delta * amount);
    });
    current.crop = keepSubjectInside(normalizeCrop(current.crop), current.subject);
  });
  return output;
}

function frameDistance(frame, start, end) {
  const span = Math.max(0.0001, end.time - start.time);
  const mix = clamp((frame.time - start.time) / span);
  return ["x", "y", "width", "height"].reduce((maximum, key) => {
    const expected = start.crop[key] + (end.crop[key] - start.crop[key]) * mix;
    return Math.max(maximum, Math.abs(frame.crop[key] - expected));
  }, 0);
}

function compressFrames(frames, tolerance) {
  if (frames.length <= 2) return frames;
  const keep = new Set([0, frames.length - 1]);
  const visit = (startIndex, endIndex) => {
    let maximum = 0;
    let maximumIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = frameDistance(frames[index], frames[startIndex], frames[endIndex]);
      if (distance > maximum) {
        maximum = distance;
        maximumIndex = index;
      }
    }
    if (maximumIndex < 0 || maximum <= tolerance) return;
    keep.add(maximumIndex);
    visit(startIndex, maximumIndex);
    visit(maximumIndex, endIndex);
  };
  visit(0, frames.length - 1);
  return [...keep].sort((left, right) => left - right).map((index) => frames[index]);
}

export function buildSmartFrameRecord({
  samples,
  sourceSize,
  targetSize,
  targetRatio,
  segment,
  settings = {},
  modelRevision = "",
  runtimeBackend = "unknown",
  analysisMs = 0,
}) {
  const motion = SMART_FRAME_MOTIONS[settings.motion] ? settings.motion : "smooth";
  const motionConfig = SMART_FRAME_MOTIONS[motion];
  const rawSamples = (Array.isArray(samples) ? samples : [])
    .filter((sample) => Number.isFinite(Number(sample?.time)))
    .map((sample) => ({
      time: Math.max(0, Number(sample.time)),
      subject: normalizeSubject(sample.subject),
      confidence: clamp(sample.subject?.score ?? sample.confidence ?? 0),
      state: sample.state || (sample.subject ? "tracked" : "lost"),
      source: sample.source || "detector",
    }))
    .sort((left, right) => left.time - right.time);
  let lastAcceptedSubject = null;
  const prepared = rawSamples.map((sample, index) => {
    if (sample.subject) lastAcceptedSubject = sample.subject;
    const previousSubject = rawSamples[Math.max(0, index - 1)]?.subject;
    const currentSubject = sample.subject || lastAcceptedSubject;
    const previousCenterX = previousSubject
      ? (previousSubject.box.xMin + previousSubject.box.xMax) / 2
      : currentSubject ? (currentSubject.box.xMin + currentSubject.box.xMax) / 2 : 0.5;
    const currentCenterX = currentSubject
      ? (currentSubject.box.xMin + currentSubject.box.xMax) / 2
      : previousCenterX;
    const leadX = clamp((currentCenterX - previousCenterX) * 0.35, -0.055, 0.055);
    return {
      ...sample,
      crop: solveSmartFrameCrop(sourceSize, targetSize, currentSubject, { ...settings, leadX }),
    };
  });
  if (!prepared.length) throw new Error("没有可用于智能构图的主体轨迹");

  const forward = smoothPass(prepared, motionConfig.smoothing, false);
  const smoothed = smoothPass(forward, Math.min(0.7, motionConfig.smoothing * 1.35), true);
  const compressed = compressFrames(smoothed, motionConfig.tolerance);
  const personFrames = prepared.filter((frame) => frame.subject?.label === "person");
  const smartStageFrames = personFrames.filter((frame) => needsSmartStage(sourceSize, targetSize, frame.subject));
  const presentation = personFrames.length && smartStageFrames.length / personFrames.length >= 0.3
    ? "safe-contain"
    : "crop";
  return normalizeSmartFrame({
    version: SMART_FRAME_VERSION,
    enabled: true,
    targetRatio,
    presentation,
    settings: {
      motion,
      padding: clamp(settings.padding ?? 0.16, 0.04, 0.4),
      maxZoom: Math.max(1, Math.min(2, Number(settings.maxZoom) || 1.45)),
    },
    sourceSize,
    sourceSignature: {
      assetId: segment?.assetId || segment?.id || "",
      sourceStart: Math.max(0, Number(segment?.sourceStart) || 0),
      sourceDuration: Math.max(0, Number(segment?.sourceDuration) || Number(segment?.duration) || 0),
      playbackRate: Math.max(0.25, Math.min(4, Number(segment?.playbackRate) || 1)),
      modelRevision,
    },
    analysisTrack: {
      samples: rawSamples,
      sourceSize,
      modelRevision,
      runtimeBackend,
      analysisMs: Math.max(0, Number(analysisMs) || 0),
    },
    stats: {
      sampleCount: prepared.length,
      anchorCount: prepared.filter((sample) => sample.source === "detector").length,
      flowCount: prepared.filter((sample) => sample.source === "flow").length,
      lostCount: prepared.filter((sample) => sample.state === "lost").length,
      runtimeBackend: runtimeBackend === "webgpu" ? "webgpu" : runtimeBackend === "wasm" ? "wasm" : "unknown",
      analysisMs: Math.max(0, Number(analysisMs) || 0),
    },
    cropKeyframes: compressed.map((frame) => ({
      time: frame.time,
      ...frame.crop,
      confidence: frame.confidence,
      state: frame.state,
    })),
  });
}

export function normalizeSmartFrame(value) {
  if (!value || value.enabled === false || !Array.isArray(value.cropKeyframes) || !value.cropKeyframes.length) return null;
  const cropKeyframes = value.cropKeyframes
    .map((frame) => ({
      time: Math.max(0, Number(frame.time) || 0),
      ...normalizeCrop(frame),
      confidence: clamp(frame.confidence ?? 0),
      state: frame.state || "tracked",
    }))
    .sort((left, right) => left.time - right.time);
  const storedVersion = Math.max(1, Number(value.version) || 1);
  const analysisSamples = (Array.isArray(value.analysisTrack?.samples) ? value.analysisTrack.samples : [])
    .filter((sample) => Number.isFinite(Number(sample?.time)))
    .map((sample) => ({
      time: Math.max(0, Number(sample.time)),
      subject: normalizeSubject(sample.subject),
      confidence: clamp(sample.subject?.score ?? sample.confidence ?? 0),
      state: sample.state || (sample.subject ? "tracked" : "lost"),
      source: sample.source || "detector",
    }))
    .sort((left, right) => left.time - right.time);
  return {
    version: SMART_FRAME_VERSION,
    enabled: true,
    targetRatio: String(value.targetRatio || "16:9"),
    presentation: storedVersion >= 2 && value.presentation === "safe-contain" ? "safe-contain" : "crop",
    settings: {
      motion: SMART_FRAME_MOTIONS[value.settings?.motion] ? value.settings.motion : "smooth",
      padding: clamp(value.settings?.padding ?? 0.16, 0.04, 0.4),
      maxZoom: storedVersion < 2 ? 1.45 : Math.max(1, Math.min(2, Number(value.settings?.maxZoom) || 1.45)),
    },
    sourceSize: {
      width: Math.max(1, Number(value.sourceSize?.width) || 1),
      height: Math.max(1, Number(value.sourceSize?.height) || 1),
    },
    sourceSignature: value.sourceSignature || {},
    stats: value.stats || {},
    analysisTrack: analysisSamples.length ? {
      samples: analysisSamples,
      sourceSize: {
        width: Math.max(1, Number(value.analysisTrack?.sourceSize?.width) || Number(value.sourceSize?.width) || 1),
        height: Math.max(1, Number(value.analysisTrack?.sourceSize?.height) || Number(value.sourceSize?.height) || 1),
      },
      modelRevision: String(value.analysisTrack?.modelRevision || value.sourceSignature?.modelRevision || ""),
      runtimeBackend: String(value.analysisTrack?.runtimeBackend || value.stats?.runtimeBackend || "unknown"),
      analysisMs: Math.max(0, Number(value.analysisTrack?.analysisMs) || Number(value.stats?.analysisMs) || 0),
    } : null,
    cropKeyframes,
  };
}

export function resolveSmartFrameCropAtTime(value, requestedTime = 0) {
  const smartFrame = normalizeSmartFrame(value);
  if (!smartFrame) return null;
  const time = Math.max(0, Number(requestedTime) || 0);
  const frames = smartFrame.cropKeyframes;
  if (time <= frames[0].time) return { ...normalizeCrop(frames[0]), presentation: smartFrame.presentation };
  if (time >= frames.at(-1).time) return { ...normalizeCrop(frames.at(-1)), presentation: smartFrame.presentation };
  const nextIndex = frames.findIndex((frame) => frame.time >= time);
  const previous = frames[Math.max(0, nextIndex - 1)];
  const next = frames[nextIndex];
  const mix = clamp((time - previous.time) / Math.max(0.0001, next.time - previous.time));
  return {
    ...normalizeCrop({
    x: previous.x + (next.x - previous.x) * mix,
    y: previous.y + (next.y - previous.y) * mix,
    width: previous.width + (next.width - previous.width) * mix,
    height: previous.height + (next.height - previous.height) * mix,
    }),
    presentation: smartFrame.presentation,
  };
}

export function smartFrameCropToPixels(crop, sourceSize) {
  const normalized = normalizeCrop(crop);
  if (!normalized) return null;
  const width = Math.max(1, Number(sourceSize?.width) || 1);
  const height = Math.max(1, Number(sourceSize?.height) || 1);
  return {
    x: normalized.x * width,
    y: normalized.y * height,
    width: normalized.width * width,
    height: normalized.height * height,
    normalized: {
      xMin: normalized.x,
      yMin: normalized.y,
      xMax: normalized.x + normalized.width,
      yMax: normalized.y + normalized.height,
      width: normalized.width,
      height: normalized.height,
    },
    presentation: crop?.presentation === "safe-contain" ? "safe-contain" : "crop",
  };
}

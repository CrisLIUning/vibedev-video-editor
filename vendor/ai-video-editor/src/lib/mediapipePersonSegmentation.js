import {
  FilesetResolver,
  ImageSegmenter,
} from "@mediapipe/tasks-vision";

const DEFAULT_WASM_ROOT = "/vendor/mediapipe/vision";
const DEFAULT_MODEL_PATH = "/assets/effects/models/selfie_segmenter.tflite";

let segmenterPromise = null;
let cpuSegmenterPromise = null;
let configuredModelPath = null;

export async function configureMediaPipePersonSegmenterModel(modelPath) {
  const next = typeof modelPath === "string" && modelPath ? modelPath : null;
  if (next === configuredModelPath) return;
  await disposeMediaPipePersonSegmenter();
  configuredModelPath = next;
}

function assertImageSize(mask, width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || mask.length !== width * height) {
    throw new Error("MediaPipe 返回了无效的人物蒙版尺寸。");
  }
}

function binaryMorphology(source, width, height, mode, radius) {
  const output = new Uint8ClampedArray(source.length);
  const useMaximum = mode === "dilate";
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = useMaximum ? 0 : 255;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) {
          if (!useMaximum) value = 0;
          continue;
        }
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) {
            if (!useMaximum) value = 0;
            continue;
          }
          const sample = source[sampleY * width + sampleX];
          value = useMaximum ? Math.max(value, sample) : Math.min(value, sample);
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function imageSourceSize(image) {
  return {
    width: Number(image?.videoWidth || image?.naturalWidth || image?.width) || 0,
    height: Number(image?.videoHeight || image?.naturalHeight || image?.height) || 0,
  };
}

function expandedPixelBox(box, width, height, padding = 0.18) {
  const boxWidth = Math.max(1, (Number(box?.xmax) - Number(box?.xmin)) * width);
  const boxHeight = Math.max(1, (Number(box?.ymax) - Number(box?.ymin)) * height);
  return {
    xmin: Math.max(0, Math.floor(Number(box?.xmin) * width - boxWidth * padding)),
    ymin: Math.max(0, Math.floor(Number(box?.ymin) * height - boxHeight * padding)),
    xmax: Math.min(width, Math.ceil(Number(box?.xmax) * width + boxWidth * padding)),
    ymax: Math.min(height, Math.ceil(Number(box?.ymax) * height + boxHeight * padding)),
  };
}

function scaleMaskIntoBox(mask, maskWidth, maskHeight, width, height, box) {
  const source = document.createElement("canvas");
  source.width = maskWidth;
  source.height = maskHeight;
  const sourceContext = source.getContext("2d");
  const sourceImage = sourceContext.createImageData(maskWidth, maskHeight);
  for (let index = 0; index < mask.length; index += 1) {
    const target = index * 4;
    sourceImage.data[target] = 255;
    sourceImage.data[target + 1] = 255;
    sourceImage.data[target + 2] = 255;
    sourceImage.data[target + 3] = mask[index];
  }
  sourceContext.putImageData(sourceImage, 0, 0);

  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const targetContext = target.getContext("2d", { willReadFrequently: true });
  targetContext.drawImage(
    source,
    0,
    0,
    maskWidth,
    maskHeight,
    box.xmin,
    box.ymin,
    box.xmax - box.xmin,
    box.ymax - box.ymin,
  );
  const rgba = targetContext.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let sourceIndex = 3, targetIndex = 0; targetIndex < alpha.length; sourceIndex += 4, targetIndex += 1) {
    alpha[targetIndex] = rgba[sourceIndex];
  }
  return alpha;
}

function dilateMask(mask, width, height, radius) {
  return binaryMorphology(mask, width, height, "dilate", radius);
}

function blurMask(mask, width, height, radius) {
  const output = new Uint8ClampedArray(mask.length);
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += mask[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum = integral[(bottom + 1) * stride + right + 1]
        - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left]
        + integral[top * stride + left];
      output[y * width + x] = Math.round(sum / ((right - left + 1) * (bottom - top + 1)));
    }
  }
  return output;
}

export function refineMediaPipeMask(alpha, width, height, options = {}) {
  const {
    threshold = 0.48,
    radius = 1,
  } = options;
  assertImageSize(alpha, width, height);
  const binary = new Uint8ClampedArray(alpha.length);
  const cutoff = Math.max(0, Math.min(255, threshold * 255));
  for (let index = 0; index < alpha.length; index += 1) {
    binary[index] = alpha[index] >= cutoff ? 255 : 0;
  }
  if (radius < 1) return binary;

  // Close pinholes first, then remove isolated speckles. Keeping the radius
  // deliberately small avoids erasing fingers and hair in the editor preview.
  const closed = binaryMorphology(
    binaryMorphology(binary, width, height, "dilate", radius),
    width,
    height,
    "erode",
    radius,
  );
  return binaryMorphology(
    binaryMorphology(closed, width, height, "erode", radius),
    width,
    height,
    "dilate",
    radius,
  );
}

export function buildSoftSubjectGate(mask, width, height, radius = 5) {
  assertImageSize(mask, width, height);
  const binary = new Uint8ClampedArray(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    binary[index] = mask[index] >= 96 ? 255 : 0;
  }
  return blurMask(
    dilateMask(binary, width, height, radius),
    width,
    height,
    Math.max(2, Math.round(radius * 0.8)),
  );
}

export function applySoftSubjectGate(alpha, subjectMask, width, height, radius = 5) {
  assertImageSize(alpha, width, height);
  if (!subjectMask) return new Uint8ClampedArray(alpha.length);
  const gate = buildSoftSubjectGate(subjectMask, width, height, radius);
  const fused = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    fused[index] = Math.round(alpha[index] * gate[index] / 255);
  }
  return fused;
}

export async function getMediaPipePersonSegmenter(options = {}) {
  if (options.delegate === "CPU") {
    cpuSegmenterPromise ??= (async () => {
      const wasmRoot = options.wasmRoot || DEFAULT_WASM_ROOT;
      const modelPath = options.modelPath || configuredModelPath || DEFAULT_MODEL_PATH;
      const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })().catch((error) => {
      cpuSegmenterPromise = null;
      throw error;
    });
    return cpuSegmenterPromise;
  }
  if (!segmenterPromise) {
    const {
      wasmRoot = DEFAULT_WASM_ROOT,
      modelPath = configuredModelPath || DEFAULT_MODEL_PATH,
    } = options;
    segmenterPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(wasmRoot);
      const createSegmenter = (delegate) => ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate,
          },
          runningMode: "IMAGE",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      try {
        return await createSegmenter("GPU");
      } catch (error) {
        console.warn("MediaPipe GPU 分割不可用，回退 CPU。", error);
        return createSegmenter("CPU");
      }
    })().catch((error) => {
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

export async function segmentMediaPipePerson(image, options = {}) {
  const initializedAt = performance.now();
  const segmenter = await getMediaPipePersonSegmenter(options);
  const initializedMs = performance.now() - initializedAt;
  const inferenceStartedAt = performance.now();
  const result = segmenter.segment(image);
  const inferenceMs = performance.now() - inferenceStartedAt;
  try {
    const masks = result.confidenceMasks || [];
    const rankedMasks = masks.map((mask, maskIndex) => {
      const probabilities = mask.getAsFloat32Array();
      let foregroundPixels = 0;
      let centerTotal = 0;
      let centerSamples = 0;
      let edgeTotal = 0;
      let edgeSamples = 0;
      for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
          const probability = probabilities[y * mask.width + x];
          if (probability >= 0.44) foregroundPixels += 1;
          const centered = x >= mask.width * 0.25 && x <= mask.width * 0.75
            && y >= mask.height * 0.2 && y <= mask.height * 0.88;
          if (centered) {
            centerTotal += probability;
            centerSamples += 1;
          } else {
            edgeTotal += probability;
            edgeSamples += 1;
          }
        }
      }
      const coverage = foregroundPixels / Math.max(1, mask.width * mask.height);
      const centerMean = centerTotal / Math.max(1, centerSamples);
      const edgeMean = edgeTotal / Math.max(1, edgeSamples);
      return {
        mask,
        maskIndex,
        probabilities,
        rank: centerMean - edgeMean * 0.55 - Math.abs(coverage - 0.42) * 0.12,
      };
    }).sort((left, right) => right.rank - left.rank);
    const selected = rankedMasks[0];
    const confidenceMask = selected?.mask;
    if (!confidenceMask) throw new Error("MediaPipe 没有返回人物置信度蒙版。");
    const probabilities = selected.probabilities;
    const alpha = new Uint8ClampedArray(probabilities.length);
    for (let index = 0; index < probabilities.length; index += 1) {
      alpha[index] = Math.round(Math.max(0, Math.min(1, probabilities[index])) * 255);
    }
    return {
      alpha,
      width: confidenceMask.width,
      height: confidenceMask.height,
      initializedMs,
      inferenceMs,
      totalMs: initializedMs + inferenceMs,
      qualityScore: Number(result.qualityScores?.[selected.maskIndex]) || 1,
      modelId: "MediaPipe SelfieSegmenter float16",
    };
  } finally {
    result.close?.();
  }
}

export async function segmentMediaPipePersonRoi(image, targetBox, options = {}) {
  const size = imageSourceSize(image);
  if (!size.width || !size.height || !targetBox) {
    throw new Error("MediaPipe ROI 分割缺少图像尺寸或人物目标框。");
  }
  const box = expandedPixelBox(
    targetBox,
    size.width,
    size.height,
    Number(options.padding) || 0.18,
  );
  const crop = document.createElement("canvas");
  crop.width = Math.max(2, box.xmax - box.xmin);
  crop.height = Math.max(2, box.ymax - box.ymin);
  crop.getContext("2d").drawImage(
    image,
    box.xmin,
    box.ymin,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  const result = await segmentMediaPipePerson(crop, options);
  const alpha = refineMediaPipeMask(
    scaleMaskIntoBox(
      result.alpha,
      result.width,
      result.height,
      size.width,
      size.height,
      box,
    ),
    size.width,
    size.height,
    {
      threshold: Number(options.threshold) || 0.46,
      radius: options.morphologyRadius ?? 1,
    },
  );
  return {
    ...result,
    alpha,
    width: size.width,
    height: size.height,
    roi: box,
  };
}

export async function disposeMediaPipePersonSegmenter() {
  const [segmenter, cpuSegmenter] = await Promise.all([
    segmenterPromise?.catch(() => null),
    cpuSegmenterPromise?.catch(() => null),
  ]);
  segmenter?.close?.();
  cpuSegmenter?.close?.();
  segmenterPromise = null;
  cpuSegmenterPromise = null;
}

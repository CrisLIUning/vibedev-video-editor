export const DEFAULT_PHOTO_PARALLAX = Object.freeze({
  enabled: false,
  quality: "balanced",
  direction: "orbit",
  strength: 0.58,
  speed: 1,
  zoom: 1.06,
  foregroundDepth: 0.68,
  backgroundDepth: 0.34,
  edgeFeather: 0.1,
});

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
};

export function normalizePhotoParallax(value) {
  const source = value && typeof value === "object" ? value : {};
  const backgroundDepth = clamp(source.backgroundDepth, 0.08, 0.6, DEFAULT_PHOTO_PARALLAX.backgroundDepth);
  const foregroundDepth = Math.max(
    backgroundDepth + 0.12,
    clamp(source.foregroundDepth, 0.4, 0.92, DEFAULT_PHOTO_PARALLAX.foregroundDepth),
  );
  return {
    ...DEFAULT_PHOTO_PARALLAX,
    ...source,
    enabled: source.enabled === true,
    quality: ["fast", "balanced", "quality"].includes(source.quality) ? source.quality : DEFAULT_PHOTO_PARALLAX.quality,
    direction: ["horizontal", "vertical", "orbit"].includes(source.direction) ? source.direction : DEFAULT_PHOTO_PARALLAX.direction,
    strength: clamp(source.strength, 0, 1, DEFAULT_PHOTO_PARALLAX.strength),
    speed: clamp(source.speed, 0.35, 2, DEFAULT_PHOTO_PARALLAX.speed),
    zoom: clamp(source.zoom, 1.01, 1.16, DEFAULT_PHOTO_PARALLAX.zoom),
    foregroundDepth,
    backgroundDepth,
    edgeFeather: clamp(source.edgeFeather, 0.02, 0.24, DEFAULT_PHOTO_PARALLAX.edgeFeather),
  };
}

const layerCache = new WeakMap();

function getLayers(canvas) {
  let layers = layerCache.get(canvas);
  if (!layers) {
    layers = {
      mid: document.createElement("canvas"),
      near: document.createElement("canvas"),
      mask: document.createElement("canvas"),
      signature: "",
    };
    layerCache.set(canvas, layers);
  }
  [layers.mid, layers.near, layers.mask].forEach((layer) => {
    if (layer.width !== canvas.width) layer.width = canvas.width;
    if (layer.height !== canvas.height) layer.height = canvas.height;
  });
  return layers;
}

function getFitRect(source, canvas, fitMode = "contain") {
  const sourceWidth = Math.max(1, Number(source?.videoWidth || source?.naturalWidth || source?.width) || 1);
  const sourceHeight = Math.max(1, Number(source?.videoHeight || source?.naturalHeight || source?.height) || 1);
  const scale = fitMode === "cover"
    ? Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight)
    : Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height };
}

function paintTransformed(context, source, canvas, { fitMode, filter, x, y, scale }) {
  const rect = getFitRect(source, canvas, fitMode);
  context.save();
  context.translate(canvas.width / 2 + x, canvas.height / 2 + y);
  context.scale(scale, scale);
  context.translate(-canvas.width / 2, -canvas.height / 2);
  context.filter = filter || "none";
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

function smoothstep(edge0, edge1, value) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function getMotion(effect, time, canvas) {
  const phase = ((Math.max(0, Number(time) || 0) * effect.speed) / 4) * Math.PI * 2;
  const amplitude = Math.min(canvas.width, canvas.height) * 0.045 * effect.strength;
  if (effect.direction === "horizontal") return { x: Math.sin(phase) * amplitude, y: Math.cos(phase) * amplitude * 0.16 };
  if (effect.direction === "vertical") return { x: Math.cos(phase) * amplitude * 0.16, y: Math.sin(phase) * amplitude };
  return { x: Math.sin(phase) * amplitude, y: Math.cos(phase) * amplitude * 0.62 };
}

function paintDepthBand(layer, mask, source, depthVisual, canvas, options, band) {
  const layerContext = layer.getContext("2d", { willReadFrequently: false });
  const maskContext = mask.getContext("2d", { willReadFrequently: true });
  [layerContext, maskContext].forEach((context) => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  });
  paintTransformed(layerContext, source, layer, options);
  paintTransformed(maskContext, depthVisual, mask, { ...options, filter: "none" });
  const image = maskContext.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const low = options.effect.backgroundDepth;
  const high = options.effect.foregroundDepth;
  const feather = options.effect.edgeFeather;
  for (let index = 0; index < data.length; index += 4) {
    const depth = data[index] / 255;
    const alpha = band === "near"
      ? smoothstep(high - feather, high + feather, depth)
      : smoothstep(low - feather, low + feather, depth) * (1 - smoothstep(high - feather, high + feather, depth));
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = Math.round(alpha * 255);
  }
  maskContext.putImageData(image, 0, 0);
  layerContext.save();
  layerContext.globalCompositeOperation = "destination-in";
  layerContext.drawImage(mask, 0, 0);
  layerContext.restore();
}

function getSourceIdentity(source) {
  return source?.currentSrc || source?.src || `${source?.width || 0}x${source?.height || 0}`;
}

/** Draws a three-plane 2.5D animation from one source image and its inverse-depth map. */
export function drawPhotoParallaxFrame(context, source, canvas, options = {}) {
  const effect = normalizePhotoParallax(options.effect);
  const depthVisual = options.depthVisual;
  const fitMode = options.fitMode || "contain";
  const filter = options.filter || "none";
  const shouldClear = options.clear !== false;
  if (shouldClear) context.clearRect(0, 0, canvas.width, canvas.height);
  if (!effect.enabled || !depthVisual) {
    paintTransformed(context, source, canvas, { fitMode, filter, x: 0, y: 0, scale: 1 });
    return;
  }

  const motion = getMotion(effect, options.time, canvas);
  const layers = getLayers(canvas);
  const backgroundTransform = { fitMode, filter, x: -motion.x * 0.42, y: -motion.y * 0.42, scale: effect.zoom + 0.055 };
  const middleTransform = { fitMode, filter, x: motion.x * 0.34, y: motion.y * 0.34, scale: effect.zoom + 0.025 };
  const foregroundTransform = { fitMode, filter, x: motion.x, y: motion.y, scale: effect.zoom };

  const layerSignature = [
    canvas.width, canvas.height, getSourceIdentity(source), getSourceIdentity(depthVisual), fitMode, filter,
    effect.backgroundDepth, effect.foregroundDepth, effect.edgeFeather,
  ].join("|");
  if (layers.signature !== layerSignature) {
    const staticTransform = { fitMode, filter, x: 0, y: 0, scale: 1, effect };
    paintDepthBand(layers.mid, layers.mask, source, depthVisual, canvas, staticTransform, "mid");
    paintDepthBand(layers.near, layers.mask, source, depthVisual, canvas, staticTransform, "near");
    layers.signature = layerSignature;
  }

  paintTransformed(context, source, canvas, backgroundTransform);
  paintTransformed(context, layers.mid, canvas, { ...middleTransform, fitMode: "contain", filter: "none" });
  paintTransformed(context, layers.near, canvas, { ...foregroundTransform, fitMode: "contain", filter: "none" });
}

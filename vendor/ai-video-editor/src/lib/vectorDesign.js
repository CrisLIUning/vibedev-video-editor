import {
  createVectorColorSlots,
  createVectorSvgDataUrl,
  getVectorAssetById,
  VECTOR_VIEWBOX_SIZE,
} from "./vectorAssets.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const HEX_COLOR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;
const VECTOR_RENDER_BUCKETS = [1200, 1800, 2400, 3200, 4096, 5120, 6400, 8192];

export const DEFAULT_VECTOR_DESIGN = Object.freeze({
  paletteEnabled: false,
  primary: "#35ead9",
  secondary: "#6c7cff",
  accent: "#ff6b8a",
  opacity: 1,
  saturation: 100,
  brightness: 100,
  contrast: 100,
  outlineWidth: 0,
  outlineColor: "#ffffff",
  shadowEnabled: false,
  shadowColor: "#000000",
  shadowBlur: 10,
  shadowX: 0,
  shadowY: 6,
  blendMode: "source-over",
});

const normalizeHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || ""))
  ? String(value).toLowerCase()
  : fallback;

export function normalizeVectorDesign(value = {}) {
  const blendMode = ["source-over", "multiply", "screen", "overlay"].includes(value.blendMode)
    ? value.blendMode
    : DEFAULT_VECTOR_DESIGN.blendMode;
  return {
    paletteEnabled: value.paletteEnabled === true,
    primary: normalizeHex(value.primary, DEFAULT_VECTOR_DESIGN.primary),
    secondary: normalizeHex(value.secondary, DEFAULT_VECTOR_DESIGN.secondary),
    accent: normalizeHex(value.accent, DEFAULT_VECTOR_DESIGN.accent),
    opacity: clamp(value.opacity ?? DEFAULT_VECTOR_DESIGN.opacity, 0, 1),
    saturation: clamp(value.saturation ?? DEFAULT_VECTOR_DESIGN.saturation, 0, 240),
    brightness: clamp(value.brightness ?? DEFAULT_VECTOR_DESIGN.brightness, 20, 200),
    contrast: clamp(value.contrast ?? DEFAULT_VECTOR_DESIGN.contrast, 20, 200),
    outlineWidth: clamp(value.outlineWidth ?? DEFAULT_VECTOR_DESIGN.outlineWidth, 0, 12),
    outlineColor: normalizeHex(value.outlineColor, DEFAULT_VECTOR_DESIGN.outlineColor),
    shadowEnabled: value.shadowEnabled === true,
    shadowColor: normalizeHex(value.shadowColor, DEFAULT_VECTOR_DESIGN.shadowColor),
    shadowBlur: clamp(value.shadowBlur ?? DEFAULT_VECTOR_DESIGN.shadowBlur, 0, 40),
    shadowX: clamp(value.shadowX ?? DEFAULT_VECTOR_DESIGN.shadowX, -30, 30),
    shadowY: clamp(value.shadowY ?? DEFAULT_VECTOR_DESIGN.shadowY, -30, 30),
    blendMode,
  };
}

function expandHexColor(value) {
  const color = String(value || "").toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color.slice(1).split("").map((digit) => `${digit}${digit}`).join("")}`;
  }
  return "";
}

function resolveVectorDefinition(segment = {}) {
  const builtInAsset = getVectorAssetById(segment.assetId || segment.id);
  const vectorBody = segment.vectorBody || builtInAsset?.vectorBody || "";
  return {
    vectorBody,
    vectorBackground: segment.vectorBackground || builtInAsset?.vectorBackground || "transparent",
    vectorColorSlots: segment.vectorColorSlots || builtInAsset?.vectorColorSlots || createVectorColorSlots(vectorBody),
  };
}

export function recolorVectorBody(body = "", designValue = {}, colorSlots = null) {
  const design = normalizeVectorDesign(designValue);
  if (!design.paletteEnabled || !body) return body;
  const slots = colorSlots || createVectorColorSlots(body);
  const replacements = new Map();
  for (const role of ["primary", "secondary", "accent"]) {
    for (const color of slots?.[role] || []) {
      const normalized = expandHexColor(color);
      if (normalized) replacements.set(normalized, design[role]);
    }
  }
  return body.replace(HEX_COLOR, (color) => replacements.get(expandHexColor(color)) || color);
}

export function getVectorRenderDimension(requestedPixels = VECTOR_VIEWBOX_SIZE) {
  const requested = Math.max(VECTOR_VIEWBOX_SIZE, Math.ceil(Number(requestedPixels) || VECTOR_VIEWBOX_SIZE));
  return VECTOR_RENDER_BUCKETS.find((size) => size >= requested)
    || VECTOR_RENDER_BUCKETS[VECTOR_RENDER_BUCKETS.length - 1];
}

export function getVectorMaximumScale(segment) {
  const scales = [
    1,
    Number(segment?.baseTransform?.scale) || 0,
    ...(Array.isArray(segment?.keyframes)
      ? segment.keyframes.map((keyframe) => Number(keyframe?.scale) || 0)
      : []),
  ];
  return Math.max(...scales);
}

export function renderVectorDesignSource(segment, designValue = segment?.vectorDesign, renderSize = {}) {
  const definition = resolveVectorDefinition(segment);
  if (!definition.vectorBody) return segment?.src || "";
  const design = normalizeVectorDesign(designValue);
  const requestedWidth = Math.max(1, Number(renderSize.targetWidth) || VECTOR_VIEWBOX_SIZE);
  const requestedHeight = Math.max(1, Number(renderSize.targetHeight) || VECTOR_VIEWBOX_SIZE);
  const pixelRatio = Math.max(1, Number(renderSize.pixelRatio) || 1);
  const scale = Math.max(1, Number(renderSize.scale) || 1);
  const dimension = getVectorRenderDimension(Math.max(requestedWidth, requestedHeight) * pixelRatio * scale);
  return createVectorSvgDataUrl(
    recolorVectorBody(definition.vectorBody, design, definition.vectorColorSlots),
    definition.vectorBackground,
    { width: dimension, height: dimension },
  );
}

export function getVectorRenderSource(segment, renderSize = {}) {
  if (!(segment?.kind === "vector" || segment?.vectorBody)) return segment?.src || "";
  return renderVectorDesignSource(segment, segment.vectorDesign, {
    ...renderSize,
    scale: renderSize.scale ?? getVectorMaximumScale(segment),
  });
}

export function getVectorDesignFilter(designValue = {}) {
  const design = normalizeVectorDesign(designValue);
  const filters = [
    `saturate(${design.saturation}%)`,
    `brightness(${design.brightness}%)`,
    `contrast(${design.contrast}%)`,
  ];
  if (design.outlineWidth > 0) {
    const width = design.outlineWidth;
    const color = design.outlineColor;
    filters.push(
      `drop-shadow(${width}px 0 0 ${color})`,
      `drop-shadow(${-width}px 0 0 ${color})`,
      `drop-shadow(0 ${width}px 0 ${color})`,
      `drop-shadow(0 ${-width}px 0 ${color})`,
    );
  }
  if (design.shadowEnabled) {
    filters.push(`drop-shadow(${design.shadowX}px ${design.shadowY}px ${design.shadowBlur}px ${design.shadowColor})`);
  }
  return filters.join(" ");
}

export function getVectorDesignAppearance(designValue = {}) {
  const design = normalizeVectorDesign(designValue);
  return {
    design,
    filter: getVectorDesignFilter(design),
    opacity: design.opacity,
    cssBlendMode: design.blendMode === "source-over" ? "normal" : design.blendMode,
    compositeOperation: design.blendMode,
  };
}

export function buildVectorDesignPatch(segment, designValue) {
  const vectorDesign = normalizeVectorDesign(designValue);
  const definition = resolveVectorDefinition(segment);
  return {
    kind: "vector",
    vectorBody: definition.vectorBody,
    vectorBackground: definition.vectorBackground,
    vectorColorSlots: definition.vectorColorSlots,
    vectorDesign,
    src: renderVectorDesignSource(segment, vectorDesign),
  };
}

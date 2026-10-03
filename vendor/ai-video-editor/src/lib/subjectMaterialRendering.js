const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function resolveSubjectMaterialShadow(outlineWidth, requestedDepth) {
  const width = Math.max(0, Number(outlineWidth) || 0);
  const depth = clamp01(requestedDepth);
  if (depth === 0) {
    return { offsetX: 0, offsetY: 0, blur: 0, opacity: 0 };
  }

  // Keep the shadow visibly separated from the outline even at mid-range values.
  // The previous sub-2px offset was almost entirely covered by the material ring.
  const intensity = Math.pow(depth, 0.72);
  return {
    offsetX: (1.5 + width * 0.2) * intensity,
    offsetY: (2.5 + width * 0.38) * intensity,
    blur: (1.4 + width * 0.3) * (0.35 + intensity * 0.65),
    opacity: intensity * 0.85,
  };
}

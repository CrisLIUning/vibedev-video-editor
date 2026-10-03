import { memo } from "react";

import { resolveSubjectMaterialShadow } from "../lib/subjectMaterialRendering.js";
import { normalizeSubjectEffect } from "../lib/subjectEffects.js";

export const SUBJECT_MATERIALS = Object.freeze([
  {
    id: "paper",
    image: "/assets/effects/paper-fiber.webp?v=3",
    titleKey: "effectMaterialPaper",
    hintKey: "effectMaterialPaperHint",
    patch: {
      outline: { color: "#f3efe4", width: 14, opacity: 1, softness: 0.4, glow: 0.08, glowRadius: 7 },
      material: { textureStrength: 0.88, irregularity: 0.48, edgeDensity: 0.44, shadowDepth: 0.34 },
    },
  },
  {
    id: "frosted",
    image: "/assets/effects/frosted-grain.webp?v=3",
    titleKey: "effectMaterialFrosted",
    hintKey: "effectMaterialFrostedHint",
    patch: {
      outline: { color: "#dbe9ee", width: 12, opacity: 0.86, softness: 2.4, glow: 0.22, glowRadius: 12 },
      material: { textureStrength: 0.72, edgeDensity: 0.72, grain: 0.64, diffusion: 0.58, shadowDepth: 0.2 },
    },
  },
  {
    id: "halo",
    image: "/assets/effects/halo-ring.webp?v=3",
    titleKey: "effectMaterialHalo",
    hintKey: "effectMaterialHaloHint",
    patch: {
      outline: { color: "#ffe4a8", width: 5, opacity: 0.95, softness: 1.1, glow: 0.82, glowRadius: 28 },
      material: { textureStrength: 0.8, edgeDensity: 0.28, diffusion: 0.72, rings: 2, ringGap: 10, shadowDepth: 0.18 },
    },
  },
  {
    id: "chrome",
    image: "/assets/effects/chrome-flow.webp?v=3",
    titleKey: "effectMaterialChrome",
    hintKey: "effectMaterialChromeHint",
    patch: {
      outline: { color: "#ffffff", width: 10, opacity: 1, softness: 0.3, glow: 0.18, glowRadius: 8 },
      material: { textureStrength: 1, textureScale: 0.72, contrast: 0.88, irregularity: 0.12, edgeDensity: 0.56, shadowDepth: 0.24 },
    },
  },
  {
    id: "impasto",
    image: "/assets/effects/impasto-paint.webp?v=3",
    titleKey: "effectMaterialImpasto",
    hintKey: "effectMaterialImpastoHint",
    patch: {
      outline: { color: "#ffffff", width: 18, opacity: 1, softness: 0.2, glow: 0.08, glowRadius: 5 },
      material: { textureStrength: 1, textureScale: 0.62, relief: 0.78, irregularity: 0.36, edgeDensity: 0.58, shadowDepth: 0.42 },
    },
  },
  {
    id: "ink",
    image: "/assets/effects/ink-bleed.webp?v=3",
    titleKey: "effectMaterialInk",
    hintKey: "effectMaterialInkHint",
    patch: {
      outline: { color: "#ffffff", width: 16, opacity: 0.92, softness: 1.4, glow: 0, glowRadius: 0 },
      material: { textureStrength: 1, textureScale: 0.8, bleed: 0.68, irregularity: 0.72, edgeDensity: 0.8, diffusion: 0.38, shadowDepth: 0.26 },
    },
  },
]);

export function getSubjectMaterial(id) {
  return SUBJECT_MATERIALS.find((material) => material.id === id) || SUBJECT_MATERIALS[0];
}

export const SubjectMaterialFilterDefs = memo(function SubjectMaterialFilterDefs({
  effect: requestedEffect,
  filterId = "subject-outline-filter",
}) {
  const effect = normalizeSubjectEffect(requestedEffect);
  const { outline, material } = effect;
  const selected = getSubjectMaterial(material.id);
  const width = Math.max(0, Number(outline.width) || 0);
  const displacement = material.id === "paper"
    ? material.irregularity * 11
    : material.id === "frosted"
      ? 4 + material.grain * 9
      : material.id === "impasto"
        ? 3 + material.relief * 8
        : material.id === "ink"
          ? 5 + material.bleed * 14
          : material.id === "chrome"
            ? material.irregularity * 3
            : 0;
  const textureOpacity = Math.max(0, Math.min(1, material.textureStrength * outline.opacity));
  const edgeFrequency = 0.006 + material.edgeDensity * 0.055;
  const blur = Math.max(
    0,
    Number(outline.softness || 0) / 2 + (material.id === "frosted" ? material.diffusion * 3.2 : material.id === "ink" ? material.diffusion * 1.6 : 0),
  );
  const secondRadius = width + material.ringGap;
  const materialShadow = resolveSubjectMaterialShadow(width, material.shadowDepth);

  return (
    <svg className="subject-effect-filter-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <filter id={filterId} x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius={width} result="expandedAlpha" />
          <feComposite in="expandedAlpha" in2="SourceAlpha" operator="out" result="baseRing" />
          {material.id === "halo" && material.rings > 1 ? <>
            <feMorphology in="SourceAlpha" operator="dilate" radius={secondRadius} result="expandedSecond" />
            <feComposite in="expandedSecond" in2="expandedAlpha" operator="out" result="secondRingRaw" />
            <feMorphology in="secondRingRaw" operator="erode" radius={Math.max(0, material.ringGap - width * 0.35)} result="secondRing" />
            <feMerge result="combinedRing"><feMergeNode in="baseRing" /><feMergeNode in="secondRing" /></feMerge>
          </> : <feComposite in="baseRing" in2="baseRing" operator="in" result="combinedRing" />}
          {displacement > 0 ? <>
            <feTurbulence
              type="fractalNoise"
              baseFrequency={edgeFrequency / material.textureScale}
              numOctaves="2"
              seed="17"
              result="materialNoise"
            />
            <feDisplacementMap in="combinedRing" in2="materialNoise" scale={displacement} xChannelSelector="R" yChannelSelector="B" result="shapedRing" />
          </> : <feComposite in="combinedRing" in2="combinedRing" operator="in" result="shapedRing" />}
          <feGaussianBlur in="shapedRing" stdDeviation={blur} result="softRing" />
          <feImage href={selected.image} x="0" y="0" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" result="materialTexture" />
          <feComponentTransfer in="materialTexture" result="contrastedTexture">
            <feFuncR type="linear" slope={0.65 + material.contrast * 1.15} intercept={-material.contrast * 0.16} />
            <feFuncG type="linear" slope={0.65 + material.contrast * 1.15} intercept={-material.contrast * 0.16} />
            <feFuncB type="linear" slope={0.65 + material.contrast * 1.15} intercept={-material.contrast * 0.16} />
          </feComponentTransfer>
          <feFlood floodColor={outline.color} floodOpacity={textureOpacity} result="materialTint" />
          <feBlend in="contrastedTexture" in2="materialTint" mode="multiply" result="tintedTexture" />
          <feComposite in="tintedTexture" in2="softRing" operator="in" result="texturedRing" />
          {material.shadowDepth > 0 ? <>
            <feDropShadow
              in="texturedRing"
              dx={materialShadow.offsetX}
              dy={materialShadow.offsetY}
              stdDeviation={materialShadow.blur}
              floodColor="#020406"
              floodOpacity={materialShadow.opacity}
              result="materialShadow"
            />
            <feMerge result="ringWithDepth"><feMergeNode in="materialShadow" /><feMergeNode in="texturedRing" /></feMerge>
          </> : <feComposite in="texturedRing" in2="texturedRing" operator="in" result="ringWithDepth" />}
          {outline.glow > 0 ? <>
            <feGaussianBlur in="ringWithDepth" stdDeviation={outline.glowRadius * outline.glow * 0.35} result="outlineGlow" />
            <feMerge><feMergeNode in="outlineGlow" /><feMergeNode in="ringWithDepth" /><feMergeNode in="SourceGraphic" /></feMerge>
          </> : <feMerge><feMergeNode in="ringWithDepth" /><feMergeNode in="SourceGraphic" /></feMerge>}
        </filter>
      </defs>
    </svg>
  );
});

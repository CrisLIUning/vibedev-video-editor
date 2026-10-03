import { getLinkedSourceAudioSegments, getVisualAudioSource } from "./sourceAudioMapping.js";
import { buildFfmpegColorGradeFilter } from "./finalColorGrade.js";
import { getCaptionFont } from "./captionFonts.js";
import {
  getAudioSpatialEffect,
  normalizeAudioSpatialAmount,
} from "./audioSpatialEffects.js";
import { getFinalSpeedCurveSourceTime } from "./finalTimeRemap.js";
import { buildRegisteredEffectFfmpegChain } from "./effectRegistry.js";
import { hasSubjectEffect, normalizeSubjectEffect } from "./subjectEffects.js";
import { normalizeCinematicDepth } from "./depthOfField.js";
import { normalizePhotoParallax } from "./photoParallax.js";

const RATIO_SIZES = Object.freeze({
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 864, height: 1080 },
  // FORK: cinema frames, same short side as 16:9.
  "21:9": { width: 1680, height: 720 },
  "2.39:1": { width: 1720, height: 720 },
});

// FFmpeg equivalents for the pinned upstream FILTER_OPTIONS CSS pipeline.
// Keep the order of each fragment aligned with the corresponding CSS filter.
const VISUAL_FILTERS = Object.freeze({
  none: "",
  cool: "eq=contrast=1.04:saturation=0.96,hue=h=8",
  film: "eq=contrast=1.12:saturation=0.82,lutrgb=r='val*0.92':g='val*0.92':b='val*0.92'",
  bright: "lutrgb=r='val*1.08':g='val*1.08':b='val*1.08',eq=contrast=0.98:saturation=1.05",
  "effect-clean": "eq=contrast=1.08:saturation=1.08,lutrgb=r='val*1.03':g='val*1.03':b='val*1.03'",
  "effect-soft": "lutrgb=r='val*1.08':g='val*1.08':b='val*1.08',eq=contrast=0.94:saturation=1.06",
  "effect-cinematic": "eq=contrast=1.18:saturation=0.86,lutrgb=r='val*0.92':g='val*0.92':b='val*0.92'",
  "effect-vivid": "eq=contrast=1.08:saturation=1.28",
  "effect-night": "lutrgb=r='val*0.82':g='val*0.82':b='val*0.82',eq=contrast=1.2:saturation=1.08",
  "effect-warm": "colorchannelmixer=rr=0.90288:rg=0.12304:rb=0.03024:gr=0.05584:gg=0.94976:gb=0.02688:br=0.04352:bg=0.08544:bb=0.86096,eq=saturation=1.12,lutrgb=r='val*1.04':g='val*1.04':b='val*1.04'",
  "effect-cold": "hue=h=12,eq=saturation=0.98:contrast=1.06",
  "effect-noir": "hue=s=0,eq=contrast=1.18",
  "effect-dream": "lutrgb=r='val*1.1':g='val*1.1':b='val*1.1',eq=saturation=1.18,gblur=sigma=0.2",
});
// FORK: the command engine validates `filter.set` against what this planner
// renders, so a filter the Agent can name is a filter the export can honour.
export const SUPPORTED_VISUAL_FILTER_IDS = Object.freeze(Object.keys(VISUAL_FILTERS));
const VISUAL_ANIMATION_IDS = new Set(["none", "fade", "zoom", "slide-left", "slide-up"]);
const TRANSITION_XFADE_IDS = Object.freeze({
  fade: "fade",
  "wipe-left": "wipeleft",
  "wipe-up": "wipeup",
  zoom: "zoomin",
  flash: "fadewhite",
  blur: "hblur",
  split: "vertopen",
});
const CUSTOM_TRANSITION_IDS = new Set(["glitch"]);

function renderError(code, message) {
  return Object.assign(new Error(message), { code });
}

function evenDimension(value, fallback, name) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 2) throw renderError("INVALID_RENDER_SETTINGS", `${name} must be at least 2`);
  return Math.max(2, Math.round(number / 2) * 2);
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw renderError("INVALID_PROJECT", `${name} must be greater than zero`);
  return number;
}

function atempoChain(rate) {
  const filters = [];
  let remaining = rate;
  while (remaining > 2) { filters.push("atempo=2"); remaining /= 2; }
  while (remaining < 0.5) { filters.push("atempo=0.5"); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(",");
}

function visibleCaptions(project) {
  if (project.captionsEnabled === false || project.trackVisibility?.caption === false) return [];
  return (project.captionSegments || []).filter((item) => !item.hidden);
}

function visibleOverlays(project) {
  if (project.trackVisibility?.overlay === false) return [];
  return (project.visualOverlaySegments || [])
    .filter((item) => item.hidden !== true)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (Number(left.item.layer) || 1) - (Number(right.item.layer) || 1) || left.index - right.index)
    .map(({ item }) => item);
}

function visibleStickers(project) {
  if (project.trackVisibility?.sticker === false) return [];
  const lanes = packTimedSegmentsIntoLanes(project.stickerSegments || [], "lane");
  return lanes.flatMap((lane, laneIndex) => (
    project.trackVisibility?.[`sticker-${laneIndex}`] === false ? [] : lane
  ))
    .filter((item) => item.hidden !== true)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (Number(left.item.layer) || 1) - (Number(right.item.layer) || 1) || left.index - right.index)
    .map(({ item }) => item);
}

function subjectAnalysisRecord(segment) {
  const record = segment?.vision?.hostAnalysis;
  if (!record || record.kind !== "video-analysis-record") return null;
  const expectedKind = segment?.subjectEffect?.targetKind === "object" ? "object" : "subject";
  if (record.analysisKind !== expectedKind || !Array.isArray(record.artifacts)) return null;
  const roles = expectedKind === "object"
    ? new Set(["object-mask", "object-cutout"])
    : new Set(["subject-mask", "subject-cutout"]);
  const artifact = record.artifacts.find((item) => roles.has(item?.role));
  return artifact?.sourceUrl && artifact?.assetId && artifact?.versionId
    ? { record, artifact }
    : null;
}

function subjectEffectRenderSpec(segment) {
  const effect = normalizeSubjectEffect(segment?.subjectEffect);
  if (!hasSubjectEffect(effect)) return null;
  const analysis = subjectAnalysisRecord(segment);
  if (!analysis) throw renderError("MISSING_RENDER_RESOURCE", `Subject effect has no pinned analysis mask: ${segment?.id || "unknown"}`);
  if (!["original", "color", "blur"].includes(effect.background.mode)) {
    throw renderError("UNSUPPORTED_RENDER_FEATURE", `Subject background mode is not renderable: ${effect.background.mode}`);
  }
  return { effect, analysis };
}

function depthEffectRenderSpec(segment) {
  const cinematicDepth = normalizeCinematicDepth(segment?.cinematicDepth);
  const photoParallax = normalizePhotoParallax(segment?.photoParallax);
  if (!cinematicDepth.enabled && !photoParallax.enabled) return null;
  if (cinematicDepth.enabled && photoParallax.enabled) {
    throw renderError("UNSUPPORTED_RENDER_FEATURE", "Cinematic depth and photo parallax cannot render on the same clip");
  }
  const record = segment?.depth?.hostAnalysis;
  const artifact = record?.kind === "video-analysis-record" && record.analysisKind === "depth"
    ? record.artifacts?.find((item) => item?.role === "depth-map")
    : null;
  if (!artifact?.sourceUrl || !artifact?.assetId || !artifact?.versionId) {
    throw renderError("MISSING_RENDER_RESOURCE", `Depth effect has no pinned depth map: ${segment?.id || "unknown"}`);
  }
  return { cinematicDepth, photoParallax, analysis: { record, artifact } };
}

function isNoopOverlayMask(mask) {
  if (!mask || !mask.type || mask.type === "none") return true;
  return mask.type === "rectangle"
    && Number(mask.width ?? 100) === 100
    && Number(mask.height ?? 100) === 100
    && Number(mask.centerX ?? 50) === 50
    && Number(mask.centerY ?? 50) === 50
    && Number(mask.feather ?? 0) === 0
    && mask.inverted !== true;
}

function isSupportedVisualMask(mask) {
  if (isNoopOverlayMask(mask)) return true;
  if (!mask || !["rectangle", "rounded", "circle"].includes(mask.type)) return false;
  const bounded = (value, fallback, min, max) => {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) && number >= min && number <= max;
  };
  if (!bounded(mask.centerX, 50, 0, 100) || !bounded(mask.centerY, 50, 0, 100)) return false;
  if (!bounded(mask.feather, 0, 0, 40)) return false;
  if (mask.type === "circle") return bounded(mask.size, 72, 0.1, 100);
  if (!bounded(mask.width, 80, 0.1, 100) || !bounded(mask.height, 80, 0.1, 100)) return false;
  return mask.type !== "rounded" || bounded(mask.cornerRadius, 12, 0, 50);
}

function animationPhase(value) {
  return {
    id: value?.id || "none",
    duration: Math.max(0.1, Math.min(3, Number(value?.duration) || 0.6)),
  };
}

function hasVisualAnimation(animation) {
  return [animationPhase(animation?.in), animationPhase(animation?.out)]
    .some((phase) => phase.id !== "none");
}

function hasUnsupportedVisualAnimation(animation) {
  return [animation?.in?.id, animation?.out?.id]
    .some((id) => id && !VISUAL_ANIMATION_IDS.has(id));
}

function isSupportedVisualFilterId(value) {
  return value == null || value === "" || Object.hasOwn(VISUAL_FILTERS, value);
}

function visualFilterChain(value) {
  return VISUAL_FILTERS[value || "none"] || "";
}

export function packTimedSegmentsIntoLanes(segments, preferredLaneKey = "") {
  const lanes = [];
  const ordered = preferredLaneKey ? [...segments] : [...segments].sort((left, right) => (Number(left.start) || 0) - (Number(right.start) || 0));
  ordered.forEach((segment) => {
    const accepts = (lane = []) => {
      const start = Number(segment.start) || 0;
      const end = start + (Number(segment.duration) || 0);
      return lane.every((item) => {
        const itemStart = Number(item.start) || 0;
        const itemEnd = itemStart + (Number(item.duration) || 0);
        return itemEnd <= start + 0.001 || end <= itemStart + 0.001;
      });
    };
    const preferred = preferredLaneKey && Number.isInteger(segment?.[preferredLaneKey])
      ? Math.max(0, segment[preferredLaneKey])
      : -1;
    while (preferred >= lanes.length) lanes.push([]);
    const laneIndex = preferred >= 0 && accepts(lanes[preferred]) ? preferred : lanes.findIndex(accepts);
    if (laneIndex >= 0) {
      lanes[laneIndex].push(segment);
      lanes[laneIndex].sort((left, right) => (Number(left.start) || 0) - (Number(right.start) || 0));
    } else lanes.push([segment]);
  });
  return lanes.length ? lanes : [[]];
}

function audibleSegments(project, segments, track) {
  const visibility = project.trackVisibility || {};
  if (visibility[track] === false) return [];
  const lanes = packTimedSegmentsIntoLanes(segments, track === "audio" ? "lane" : "");
  return lanes.flatMap((lane, laneIndex) => (
    visibility[`${track}-${laneIndex}`] === false ? [] : lane
  )).filter((segment) => segment.hidden !== true && segment.muted !== true);
}

export function getFfmpegRenderMediaRequirements(project = {}) {
  const visualAnalyses = (project.visualSegments || []).flatMap((segment) => {
    const specs = [subjectEffectRenderSpec(segment), depthEffectRenderSpec(segment)].filter(Boolean);
    return specs.map((spec) => ({
      id: spec.analysis.record.analysisId, segmentId: segment.id, ...spec.analysis.artifact,
    }));
  });
  return {
    visuals: project.visualSegments || [],
    overlays: visibleOverlays(project),
    stickers: visibleStickers(project),
    audioSegments: audibleSegments(project, project.audioSegments || [], "audio"),
    musicSegments: audibleSegments(project, project.musicSegments || [], "music"),
    // FORK: the video clips whose own sound plays — the browser export
    // extracts it per clip (embeddedVideoAudioExport); a headless host says
    // which of these files carry a sound stream through
    // `media.sourceAudioSegments`, and only those join the mix.
    sourceAudio: sourceAudioCandidates(project),
    analyses: visualAnalyses,
  };
}

// FORK: video clips that would sound in the browser export: not muted, not
// with their own audio switched off, and the source lane shown.
function sourceAudioCandidates(project) {
  if (project.trackVisibility?.source === false) return [];
  const volume = project.sourceAudioVolume ?? 1;
  const origin = project.sourceAudioSource;
  const hasSourceAudio = Boolean(origin?.assetVersionId || origin?.sourceUrl);
  const extracted = [];
  if (hasSourceAudio && Number(volume) !== 0) {
    const linked = project.sourceAudioLinked !== false
      ? getLinkedSourceAudioSegments(project.visualSegments || [], project.sourceAudioAssetId || "", project.sourceAudioDuration || 0)
      : [{ id: "source-audio", start: project.sourceAudioStart || 0, duration: project.sourceAudioDuration || 0, sourceStart: 0, sourceDuration: project.sourceAudioDuration || 0, playbackRate: 1 }];
    extracted.push(...linked.filter(segment => segment.duration > 0).map(segment => ({ ...segment, ...origin, id: segment.id, volume,
      spatialEffect: project.sourceAudioSpatialEffect, spatialAmount: project.sourceAudioSpatialAmount })));
  }
  let cursor = 0;
  return [...extracted, ...(project.visualSegments || []).flatMap(segment => {
    const start = cursor; cursor += Math.max(0, Number(segment.duration) || 0);
    if (getVisualAudioSource(segment, { hasSourceAudio, sourceAudioAssetId: project.sourceAudioAssetId, visualSegments: project.visualSegments }) !== "embedded") return [];
    return [{ ...segment, start, volume: segment.volume ?? 1,
      sourceStart: Math.max(0, Number(segment.sourceStart) || 0),
      sourceDuration: Number(segment.sourceDuration) || segment.duration * (Number(segment.playbackRate) || 1) }];
  })];
}

function sourceAudioSegmentsForRender(project, entries) {
  const known = new Set(entries.map(entry => entry.id));
  return sourceAudioCandidates(project).filter(segment => known.has(segment.id));
}

function assColor(value, opacity = 1) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
  const hex = match?.[1] || "ffffff";
  const alpha = Math.round((1 - Math.max(0, Math.min(1, Number(opacity)))) * 255);
  return `&H${alpha.toString(16).padStart(2, "0")}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase();
}

function assTimestamp(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function assText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replace(/\r?\n/g, "\\N");
}

function captionPoint(placement, width, height) {
  const named = {
    top: { x: 50, y: 18 },
    middle: { x: 50, y: 50 },
    bottom: { x: 50, y: 78 },
  };
  const point = typeof placement === "string" ? named[placement] || named.bottom : placement || named.bottom;
  const x = Number.isFinite(Number(point.x)) ? Number(point.x) : 50;
  const y = Number.isFinite(Number(point.y)) ? Number(point.y) : 78;
  return { x: Math.round(width * x / 100), y: Math.round(height * y / 100) };
}

function buildCaptionAss(project, width, height, duration, rendererResources = {}) {
  const captions = visibleCaptions(project);
  if (!captions.length) return null;
  const style = project.captionStyle || {};
  const scale = Math.min(width, height) / 360;
  const fontSize = Math.max(1, (Number(project.captionSize) || 14) * scale);
  const primary = assColor(style.textColor || "#f5fbff", 1);
  const backgroundOpacity = Number.isFinite(Number(style.backgroundOpacity)) ? Number(style.backgroundOpacity) : 0.62;
  const background = assColor(style.backgroundColor || "#05080d", backgroundOpacity);
  const outline = assColor(style.borderColor || "#ffffff", 1);
  const borderWidth = Math.max(0, Number(style.borderWidth) || 0) * scale;
  const shadow = Math.max(0, Number(style.shadowOpacity ?? 0.45)) > 0
    ? Math.max(1, scale) * (style.effect === "neon" ? 2.6 : 1)
    : 0;
  const fontById = new Map();
  const captionFonts = rendererResources.captionFonts || {};
  captions.forEach((caption) => {
    const fontId = caption.fontId || style.fontId || "default";
    if (fontById.has(fontId)) return;
    if (fontId === "default") {
      fontById.set(fontId, { id: fontId, family: "Arial", weight: 700 });
      return;
    }
    const resource = captionFonts[fontId];
    const catalogFont = getCaptionFont(fontId);
    if (
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(fontId)
      || !resource
      || catalogFont.id !== fontId
      || typeof resource.path !== "string"
      || !resource.path.trim()
    ) {
      throw renderError("MISSING_RENDER_RESOURCE", `Verified caption font is unavailable: ${fontId}`);
    }
    fontById.set(fontId, {
      id: fontId,
      family: catalogFont.family,
      weight: catalogFont.weight || 700,
      sourcePath: resource.path,
      filename: `caption-font-${fontId}.ttf`,
    });
  });
  const fonts = [...fontById.values()];
  const styleNameById = new Map(fonts.map((font, index) => [font.id, index === 0 ? "Default" : `Font${index}`]));
  const events = captions.map((caption) => {
    const start = Math.max(0, Number(caption.start) || 0);
    const end = Math.min(duration, Number(caption.end));
    if (!caption.text || !Number.isFinite(end) || end <= start) {
      throw renderError("INVALID_PROJECT", `Caption ${caption.id || "unknown"} must have text and a positive time range`);
    }
    const point = captionPoint(caption.placement ?? project.captionPlacement ?? project.captionPosition, width, height);
    const fontId = caption.fontId || style.fontId || "default";
    return `Dialogue: 0,${assTimestamp(start)},${assTimestamp(end)},${styleNameById.get(fontId)},,0,0,0,,{\\pos(${point.x},${point.y})}${assText(caption.text)}`;
  });
  const assStyles = fonts.map((font) => (
    `Style: ${styleNameById.get(font.id)},${font.family},${fontSize.toFixed(2)},${primary},${primary},${outline},${background},${font.weight >= 600 ? -1 : 0},0,0,0,100,100,0,0,3,${borderWidth.toFixed(2)},${shadow.toFixed(2)},5,0,0,0,1`
  ));
  return {
    content: [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...assStyles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
    ].join("\n"),
    fontSidecars: fonts
      .filter((font) => font.sourcePath)
      .map((font) => ({ filename: font.filename, sourcePath: font.sourcePath })),
  };
}

function assertSupportedProject(project) {
  const unsupported = [];
  const overlays = visibleOverlays(project);
  const audio = audibleSegments(project, project.audioSegments || [], "audio");
  const music = audibleSegments(project, project.musicSegments || [], "music");
  const unresolvedMigrationWarnings = (project.vibedevMigrationWarnings || []).filter((warning) => (
    !String(warning).endsWith(":loop-requires-native-fallback")
  ));
  if (unresolvedMigrationWarnings.length) unsupported.push("unresolved migration features");
  if (project.captionStyle?.effect && !["none", "normal", "neon"].includes(project.captionStyle.effect)) unsupported.push("caption effects");
  if (visibleStickers(project).some((item) => item.type && item.type !== "image")) unsupported.push("sticker media types");
  if (overlays.some((item) => !["image", "video"].includes(item.type))) unsupported.push("overlay media types");
  if (overlays.some((item) => !isSupportedVisualMask(item.mask))) unsupported.push("overlay masks");
  overlays.forEach((item) => buildRegisteredEffectFfmpegChain(item.effects, { mediaType: item.type }));
  if (overlays.some((item) => !isSupportedVisualFilterId(item.filterId) || (item.filter && item.filter !== "none"))) unsupported.push("overlay filters");
  if (overlays.some((item) => hasUnsupportedVisualAnimation(item.animation))) unsupported.push("overlay animations");
  if (overlays.some((item) => item.vision || item.subjectEffect || item.depth || item.cinematicDepth?.enabled || item.photoParallax?.enabled)) unsupported.push("overlay effects");
  if (project.trackVisibility?.source !== false && (project.sourceAudioSegments || []).length) unsupported.push("source audio");
  if ((project.visualSegments || []).some((item) => item.transition?.id && item.transition.id !== "none" && !Object.hasOwn(TRANSITION_XFADE_IDS, item.transition.id) && !CUSTOM_TRANSITION_IDS.has(item.transition.id))) unsupported.push("transitions");
  (project.visualSegments || []).forEach((item) => buildRegisteredEffectFfmpegChain(item.effects, { mediaType: item.type }));
  if (!isSupportedVisualFilterId(project.selectedFilterId) || (project.visualSegments || []).some((item) => !isSupportedVisualFilterId(item.filterId) || hasUnsupportedVisualAnimation(item.animation) || !isSupportedVisualMask(item.mask) || (item.filter && item.filter !== "none"))) unsupported.push("visual effects");
  (project.visualSegments || []).forEach((item) => {
    const spec = subjectEffectRenderSpec(item);
    const depthSpec = depthEffectRenderSpec(item);
    if ((spec || depthSpec) && (item.baseTransform || hasVisualAnimation(item.animation) || normalizeRenderVisualKeyframes(item.keyframes).length || !isNoopOverlayMask(item.mask))) {
      unsupported.push("analysis effect transforms");
    }
    if (spec && depthSpec) unsupported.push("combined subject and depth effects");
  });
  if (unsupported.length) {
    throw renderError("UNSUPPORTED_RENDER_FEATURE", `Headless render does not yet support: ${[...new Set(unsupported)].join(", ")}`);
  }
}

function resolveVisualPath(segment, media, extractedFiles) {
  const entry = (media.visuals || []).find((item) => [segment.id, segment.archiveMediaId, segment.assetId].includes(item.id));
  const path = entry?.path ? extractedFiles.get(entry.path) : null;
  if (!path) throw renderError("MISSING_MEDIA", `Portable media is missing for visual clip: ${segment.id}`);
  return path;
}

function resolveOverlayPath(segment, media, extractedFiles) {
  const entry = (media.overlays || []).find((item) => [segment.id, segment.archiveMediaId, segment.assetId].includes(item.id));
  const path = entry?.path ? extractedFiles.get(entry.path) : null;
  if (!path) throw renderError("MISSING_MEDIA", `Portable media is missing for visual overlay: ${segment.id}`);
  return path;
}

function resolveStickerPath(segment, media, extractedFiles) {
  const entry = (media.stickers || []).find((item) => [segment.id, segment.archiveMediaId, segment.assetId].includes(item.id));
  const path = entry?.path ? extractedFiles.get(entry.path) : null;
  if (!path) throw renderError("MISSING_MEDIA", `Portable media is missing for Sticker: ${segment.id}`);
  return path;
}

function resolveAnalysisPath(spec, media, extractedFiles) {
  const entry = (media.analyses || []).find((item) => item.id === spec.analysis.record.analysisId);
  const path = entry?.path ? extractedFiles.get(entry.path) : null;
  if (!path) throw renderError("MISSING_MEDIA", `Portable analysis mask is missing: ${spec.analysis.record.analysisId}`);
  return path;
}

function ffmpegHexColor(value, fallback = "000000") {
  const match = /^#?([0-9a-f]{6})$/iu.exec(String(value || ""));
  return `0x${match?.[1] || fallback}`;
}

function addSubjectEffectSource({
  args, filters, inputs, segment, index, visualInput, trim, visualFilterSuffix,
  colorGradeSuffix, media, extractedFiles, width, height, frameRate, clipDuration,
}) {
  const spec = subjectEffectRenderSpec(segment);
  if (!spec) return null;
  const maskPath = resolveAnalysisPath(spec, media, extractedFiles);
  const maskInput = inputs.count++;
  const isImageMask = String(spec.analysis.artifact.mimeType || "").startsWith("image/");
  if (isImageMask) args.push("-loop", "1", "-t", String(clipDuration), "-i", maskPath);
  else args.push("-i", maskPath);
  const source = `[vsubjectsource${index}]`;
  const mask = `[vsubjectmask${index}]`;
  filters.push(`${visualInput}${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black${visualFilterSuffix}${colorGradeSuffix},fps=${frameRate},setsar=1,format=rgba,setpts=PTS-STARTPTS${source}`);
  filters.push(`[${maskInput}:v]trim=duration=${graphNumber(clipDuration)},scale=${width}:${height},fps=${frameRate},format=gray,setpts=PTS-STARTPTS${mask}`);

  const effect = spec.effect;
  const outlineEnabled = effect.outline.enabled && effect.outline.width > 0;
  const maskLabels = outlineEnabled
    ? [`[vsubjectmaskcut${index}]`, `[vsubjectmaskgrow${index}]`, `[vsubjectmaskinner${index}]`]
    : [`[vsubjectmaskcut${index}]`];
  filters.push(`${mask}${maskLabels.length > 1 ? `split=${maskLabels.length}${maskLabels.join("")}` : `null${maskLabels[0]}`}`);

  const background = `[vsubjectbackground${index}]`;
  const subjectInput = `[vsubjectinput${index}]`;
  if (effect.background.visible === false) {
    filters.push(`${source}null${subjectInput}`);
    filters.push(`color=c=black:s=${width}x${height}:r=${frameRate}:d=${graphNumber(clipDuration)},format=rgba${background}`);
  } else if (effect.background.mode === "color") {
    filters.push(`${source}null${subjectInput}`);
    filters.push(`color=c=${ffmpegHexColor(effect.background.color)}:s=${width}x${height}:r=${frameRate}:d=${graphNumber(clipDuration)},format=rgba${background}`);
  } else {
    const backgroundInput = `[vsubjectbackgroundinput${index}]`;
    filters.push(`${source}split=2${subjectInput}${backgroundInput}`);
    filters.push(effect.background.mode === "blur"
      ? `${backgroundInput}gblur=sigma=${graphNumber(Math.max(0.1, effect.background.blur))}${background}`
      : `${backgroundInput}null${background}`);
  }

  const cutout = `[vsubjectcutout${index}]`;
  filters.push(`${subjectInput}${maskLabels[0]}alphamerge${cutout}`);
  let composite = background;
  if (outlineEnabled) {
    const grown = `[vsubjectgrown${index}]`;
    const outlineMask = `[vsubjectoutlinemask${index}]`;
    const outlineColor = `[vsubjectoutlinecolor${index}]`;
    const outlineLayer = `[vsubjectoutline${index}]`;
    const dilation = new Array(Math.max(1, Math.round(effect.outline.width)))
      .fill("dilation=coordinates=255").join(",");
    filters.push(`${maskLabels[1]}${dilation}${grown}`);
    filters.push(`${grown}${maskLabels[2]}blend=all_mode=subtract${outlineMask}`);
    filters.push(`color=c=${ffmpegHexColor(effect.outline.color, "ffffff")}:s=${width}x${height}:r=${frameRate}:d=${graphNumber(clipDuration)},format=rgba${outlineColor}`);
    filters.push(`${outlineColor}${outlineMask}alphamerge,colorchannelmixer=aa=${graphNumber(effect.outline.opacity)}${outlineLayer}`);
    const outlined = `[vsubjectoutlined${index}]`;
    filters.push(`${background}${outlineLayer}overlay=eof_action=pass:repeatlast=1${outlined}`);
    composite = outlined;
  }
  filters.push(`${composite}${cutout}overlay=eof_action=pass:repeatlast=1,format=yuv420p[v${index}]`);
  return `[v${index}]`;
}

function addDepthEffectSource({
  args, filters, inputs, segment, index, visualInput, trim, visualFilterSuffix,
  colorGradeSuffix, media, extractedFiles, width, height, frameRate, clipDuration,
}) {
  const spec = depthEffectRenderSpec(segment);
  if (!spec) return null;
  const depthPath = resolveAnalysisPath(spec, media, extractedFiles);
  const depthInput = inputs.count++;
  const isImageDepth = String(spec.analysis.artifact.mimeType || "").startsWith("image/");
  if (isImageDepth) args.push("-loop", "1", "-t", String(clipDuration), "-i", depthPath);
  else args.push("-i", depthPath);
  const source = `[vdepthsource${index}]`;
  const depth = `[vdepthmap${index}]`;
  filters.push(`${visualInput}${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black${visualFilterSuffix}${colorGradeSuffix},fps=${frameRate},setsar=1,format=rgba,setpts=PTS-STARTPTS${source}`);
  filters.push(`[${depthInput}:v]trim=duration=${graphNumber(clipDuration)},scale=${width}:${height},fps=${frameRate},format=gray,setpts=PTS-STARTPTS${depth}`);

  if (spec.cinematicDepth.enabled) {
    const sharp = `[vdepthsharp${index}]`;
    const blurInput = `[vdepthblurinput${index}]`;
    const blurred = `[vdepthblurred${index}]`;
    const blurMask = `[vdepthblurmask${index}]`;
    const blurLayer = `[vdepthblurlayer${index}]`;
    const focus = Math.round(spec.cinematicDepth.focus * 255);
    const range = Math.round(spec.cinematicDepth.focusRange * 255);
    filters.push(`${source}split=2${sharp}${blurInput}`);
    filters.push(`${blurInput}gblur=sigma=${graphNumber(spec.cinematicDepth.blur)},format=rgba${blurred}`);
    filters.push(`${depth}lut=y='if(gt(abs(val-${focus}),${range}),255,0)'${blurMask}`);
    filters.push(`${blurred}${blurMask}alphamerge${blurLayer}`);
    filters.push(`${sharp}${blurLayer}overlay=eof_action=pass:repeatlast=1,format=yuv420p[v${index}]`);
    return `[v${index}]`;
  }

  const effect = spec.photoParallax;
  const background = `[vparallaxbackground${index}]`;
  const foregroundInput = `[vparallaxforegroundinput${index}]`;
  const foregroundMask = `[vparallaxmask${index}]`;
  const foreground = `[vparallaxforeground${index}]`;
  const amplitude = Math.round(Math.min(width, height) * 0.045 * effect.strength);
  const threshold = Math.round(effect.foregroundDepth * 255);
  const phase = `${graphNumber(effect.speed * Math.PI / 2)}*t`;
  filters.push(`${source}split=2${background}${foregroundInput}`);
  filters.push(`${depth}lut=y='if(gte(val,${threshold}),255,0)'${foregroundMask}`);
  filters.push(`${foregroundInput}${foregroundMask}alphamerge,scale=w='trunc(iw*${graphNumber(effect.zoom)}/2)*2':h='trunc(ih*${graphNumber(effect.zoom)}/2)*2'${foreground}`);
  const backgroundScaled = `[vparallaxbgscaled${index}]`;
  filters.push(`${background}scale=w='trunc(iw*${graphNumber(effect.zoom + 0.055)}/2)*2':h='trunc(ih*${graphNumber(effect.zoom + 0.055)}/2)*2',crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2${backgroundScaled}`);
  const x = effect.direction === "vertical" ? `-${amplitude}*0.16*cos(${phase})` : `-${amplitude}*sin(${phase})`;
  const y = effect.direction === "horizontal" ? `-${amplitude}*0.16*cos(${phase})` : `-${Math.round(amplitude * 0.62)}*cos(${phase})`;
  filters.push(`${backgroundScaled}${foreground}overlay=x='(W-w)/2+(${x})':y='(H-h)/2+(${y})':eval=frame:eof_action=pass:repeatlast=1,format=yuv420p[v${index}]`);
  return `[v${index}]`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function graphNumber(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function normalizedTimeRemapRuntime(segment, name) {
  let runtime = segment?.vibedevTimeRemapRuntime;
  if (!runtime && segment?.speedCurve?.enabled) {
    const duration = finitePositive(segment.duration, `${name} speed curve duration`);
    const pointCount = Array.isArray(segment.speedCurve.points) ? segment.speedCurve.points.length : 0;
    const sliceCount = Math.max(12, Math.min(48, pointCount * 12));
    runtime = {
      duration,
      segments: Array.from({ length: sliceCount }, (_, index) => {
        const timelineStart = duration * index / sliceCount;
        const timelineEnd = duration * (index + 1) / sliceCount;
        const sourceInSeconds = getFinalSpeedCurveSourceTime(segment, timelineStart);
        const sourceOutSeconds = getFinalSpeedCurveSourceTime(segment, timelineEnd);
        const durationSeconds = timelineEnd - timelineStart;
        return {
          kind: "play",
          sourceInSeconds,
          sourceOutSeconds,
          durationSeconds,
          rate: Math.max(0.25, Math.min(4, Math.abs(sourceOutSeconds - sourceInSeconds) / durationSeconds)),
          reverse: sourceOutSeconds < sourceInSeconds,
        };
      }),
    };
  }
  if (!runtime) return null;
  if (!Array.isArray(runtime.segments) || runtime.segments.length < 1 || runtime.segments.length > 64) {
    throw renderError("INVALID_PROJECT", `${name} time remap must contain 1-64 steps`);
  }
  const steps = runtime.segments.map((step, index) => {
    const durationSeconds = finitePositive(step?.durationSeconds, `${name} time remap step ${index + 1} duration`);
    if (step?.kind === "freeze") {
      const sourceSeconds = Number(step.sourceSeconds);
      if (!Number.isFinite(sourceSeconds) || sourceSeconds < 0) {
        throw renderError("INVALID_PROJECT", `${name} freeze step ${index + 1} has an invalid source time`);
      }
      return { kind: "freeze", sourceSeconds, durationSeconds };
    }
    if (step?.kind !== "play") {
      throw renderError("INVALID_PROJECT", `${name} time remap step ${index + 1} has an invalid kind`);
    }
    const sourceInSeconds = Number(step.sourceInSeconds);
    const sourceOutSeconds = Number(step.sourceOutSeconds);
    const rate = Number(step.rate);
    if (
      !Number.isFinite(sourceInSeconds)
      || !Number.isFinite(sourceOutSeconds)
      || sourceInSeconds < 0
      || sourceOutSeconds < 0
      || Math.abs(sourceOutSeconds - sourceInSeconds) < 0.001
      || !Number.isFinite(rate)
      || rate < 0.25
      || rate > 4
    ) {
      throw renderError("INVALID_PROJECT", `${name} play step ${index + 1} is invalid`);
    }
    return {
      kind: "play",
      sourceInSeconds,
      sourceOutSeconds,
      durationSeconds,
      rate,
      reverse: step.reverse === true || sourceOutSeconds < sourceInSeconds,
    };
  });
  const duration = finitePositive(runtime.duration, `${name} time remap duration`);
  const summedDuration = steps.reduce((total, step) => total + step.durationSeconds, 0);
  if (Math.abs(duration - summedDuration) > 0.05 || Math.abs(duration - Number(segment.duration)) > 0.05) {
    throw renderError("INVALID_PROJECT", `${name} time remap duration does not match its clip`);
  }
  return { duration, steps };
}

function addRemappedVideoSource({ filters, inputIndex, segment, prefix, frameRate }) {
  const runtime = normalizedTimeRemapRuntime(segment, `Visual clip ${segment.id || prefix}`);
  if (!runtime) return null;
  const inputLabels = runtime.steps.map((_, index) => `[${prefix}step${index}in]`);
  if (runtime.steps.length === 1) filters.push(`[${inputIndex}:v]null${inputLabels[0]}`);
  else filters.push(`[${inputIndex}:v]split=${runtime.steps.length}${inputLabels.join("")}`);
  const outputLabels = runtime.steps.map((step, index) => {
    const output = `[${prefix}step${index}]`;
    if (step.kind === "freeze") {
      const frameEnd = step.sourceSeconds + 1 / frameRate;
      filters.push(`${inputLabels[index]}trim=start=${graphNumber(step.sourceSeconds)}:end=${graphNumber(frameEnd)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${graphNumber(step.durationSeconds)},trim=duration=${graphNumber(step.durationSeconds)},setpts=PTS-STARTPTS${output}`);
    } else {
      const sourceStart = Math.min(step.sourceInSeconds, step.sourceOutSeconds);
      const sourceDuration = Math.abs(step.sourceOutSeconds - step.sourceInSeconds);
      filters.push(`${inputLabels[index]}trim=start=${graphNumber(sourceStart)}:duration=${graphNumber(sourceDuration)},${step.reverse ? "reverse," : ""}setpts=(PTS-STARTPTS)/${graphNumber(step.rate)},trim=duration=${graphNumber(step.durationSeconds)},setpts=PTS-STARTPTS${output}`);
    }
    return output;
  });
  const output = `[${prefix}]`;
  filters.push(`${outputLabels.join("")}concat=n=${outputLabels.length}:v=1:a=0${output}`);
  return output;
}

function addRemappedAudioSource({ filters, inputIndex, segment, prefix }) {
  const runtime = normalizedTimeRemapRuntime(segment, `Audio clip ${segment.id || prefix}`);
  if (!runtime) return null;
  const playSteps = runtime.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.kind === "play");
  const playInputs = new Map();
  if (playSteps.length === 1) {
    playInputs.set(playSteps[0].index, `[${prefix}play${playSteps[0].index}in]`);
    filters.push(`[${inputIndex}:a]anull${playInputs.get(playSteps[0].index)}`);
  } else if (playSteps.length > 1) {
    const labels = playSteps.map(({ index }) => `[${prefix}play${index}in]`);
    filters.push(`[${inputIndex}:a]asplit=${labels.length}${labels.join("")}`);
    playSteps.forEach(({ index }, position) => playInputs.set(index, labels[position]));
  }
  const outputLabels = runtime.steps.map((step, index) => {
    const output = `[${prefix}step${index}]`;
    if (step.kind === "freeze") {
      filters.push(`anullsrc=r=48000:cl=stereo:d=${graphNumber(step.durationSeconds)}${output}`);
    } else {
      const sourceStart = Math.min(step.sourceInSeconds, step.sourceOutSeconds);
      const sourceDuration = Math.abs(step.sourceOutSeconds - step.sourceInSeconds);
      filters.push(`${playInputs.get(index)}atrim=start=${graphNumber(sourceStart)}:duration=${graphNumber(sourceDuration)},${step.reverse ? "areverse," : ""}asetpts=PTS-STARTPTS,${atempoChain(step.rate)},atrim=duration=${graphNumber(step.durationSeconds)},aformat=sample_rates=48000:channel_layouts=stereo${output}`);
    }
    return output;
  });
  const output = `[${prefix}source]`;
  filters.push(`${outputLabels.join("")}concat=n=${outputLabels.length}:v=0:a=1${output}`);
  return output;
}

function normalizeRenderVisualTransform(value = {}) {
  return {
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    scale: Math.max(0.1, Number(value.scale) || 1),
    rotation: Number(value.rotation) || 0,
    opacity: Math.max(0, Math.min(1, Number.isFinite(Number(value.opacity)) ? Number(value.opacity) : 1)),
  };
}

function normalizeRenderVisualKeyframes(keyframes = []) {
  return keyframes
    .filter((frame) => frame && Number.isFinite(Number(frame.time)))
    .map((frame) => ({ ...frame, time: Math.max(0, Number(frame.time)) }))
    .sort((left, right) => left.time - right.time)
    .reduce((frames, frame) => {
      const previous = frames.at(-1);
      if (!previous || Math.abs(previous.time - frame.time) > 0.04) {
        frames.push(frame);
      } else {
        frames[frames.length - 1] = { ...previous, ...frame };
      }
      return frames;
    }, []);
}

function visualPropertyValue(field, value) {
  const number = Number(value);
  if (field === "scale") return Math.max(0.1, number || 1);
  if (field === "opacity") return Math.max(0, Math.min(1, Number.isFinite(number) ? number : 1));
  return number || 0;
}

function interpolateVisualExpression(left, right, timeExpression) {
  if (Math.abs(left.value - right.value) < 1e-9) return graphNumber(left.value);
  const duration = Math.max(0.0001, right.time - left.time);
  return `(${graphNumber(left.value)}+(${graphNumber(right.value - left.value)})*` +
    `((${timeExpression}-${graphNumber(left.time)})/${graphNumber(duration)}))`;
}

/** Compile the same item-local, per-property linear interpolation used by
 * resolveVisualTransform() in the upstream preview. A property's first
 * keyframe takes control at its own timestamp; the base value is held before
 * that point and partial keyframes do not disturb other properties. */
function visualFieldExpression(transform, keyframes, field, timeExpression) {
  const base = normalizeRenderVisualTransform(transform)[field];
  const points = normalizeRenderVisualKeyframes(keyframes)
    .filter((frame) => Number.isFinite(Number(frame[field])))
    .map((frame) => ({
      time: Math.max(0, Number(frame.time) || 0),
      value: visualPropertyValue(field, frame[field]),
    }));
  if (!points.length) return graphNumber(base);

  let expression = graphNumber(points.at(-1).value);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const left = points[index];
    const right = points[index + 1];
    expression = `if(lte(${timeExpression},${graphNumber(right.time)}),` +
      `${interpolateVisualExpression(left, right, timeExpression)},${expression})`;
  }
  const first = points[0];
  return first.time > 0
    ? `if(lt(${timeExpression},${graphNumber(first.time)}),${graphNumber(base)},${expression})`
    : expression;
}

function animationPhaseFieldExpression(phase, direction, field, timeExpression, clipDuration) {
  if (phase.id === "none" || field === "rotation") return ["scale", "opacity"].includes(field) ? "1" : "0";
  const duration = graphNumber(phase.duration);
  const start = graphNumber(Math.max(0, clipDuration - phase.duration));
  const active = direction === "in"
    ? `lt(${timeExpression},${duration})`
    : `gt(${timeExpression},${start})`;
  const remaining = direction === "in"
    ? `pow(1-${timeExpression}/${duration},3)`
    : `pow((${timeExpression}-${start})/${duration},3)`;
  if (field === "opacity" && phase.id === "fade") return `if(${active},(1-${remaining}),1)`;
  if (field === "scale" && phase.id === "zoom") return `if(${active},(1-0.18*${remaining}),1)`;
  if (field === "x" && phase.id === "slide-left") return `if(${active},-18*${remaining},0)`;
  if (field === "y" && phase.id === "slide-up") return `if(${active},18*${remaining},0)`;
  return ["scale", "opacity"].includes(field) ? "1" : "0";
}

function animatedVisualFieldExpression(transform, keyframes, animation, clipDuration, field, timeExpression) {
  const base = visualFieldExpression(transform, keyframes, field, timeExpression);
  if (!hasVisualAnimation(animation) || field === "rotation") return base;
  const incoming = animationPhaseFieldExpression(animationPhase(animation?.in), "in", field, timeExpression, clipDuration);
  const outgoing = animationPhaseFieldExpression(animationPhase(animation?.out), "out", field, timeExpression, clipDuration);
  if (["scale", "opacity"].includes(field)) {
    if (incoming === "1" && outgoing === "1") return base;
    return `(${base})*(${incoming})*(${outgoing})`;
  }
  if (incoming === "0" && outgoing === "0") return base;
  return `(${base})+(${incoming})+(${outgoing})`;
}

function visualMaskAlphaExpression(mask) {
  if (isNoopOverlayMask(mask)) return "";
  const centerX = graphNumber(Number(mask.centerX ?? 50) / 100);
  const centerY = graphNumber(Number(mask.centerY ?? 50) / 100);
  let distance;
  let featherBase;
  if (mask.type === "circle") {
    const diameter = graphNumber(Number(mask.size ?? 72) / 100);
    const radius = graphNumber(Number(mask.size ?? 72) / 200);
    distance = `sqrt(pow(X-W*${centerX},2)+pow(Y-H*${centerY},2))-min(W,H)*${radius}`;
    featherBase = `min(W,H)*${diameter}`;
  } else {
    const width = graphNumber(Number(mask.width ?? 80) / 100);
    const height = graphNumber(Number(mask.height ?? 80) / 100);
    const halfWidth = graphNumber(Number(mask.width ?? 80) / 200);
    const halfHeight = graphNumber(Number(mask.height ?? 80) / 200);
    const radiusRatio = mask.type === "rounded"
      ? graphNumber(Number(mask.cornerRadius ?? 12) / 100)
      : "0";
    const radius = `min(W*${width},H*${height})*${radiusRatio}`;
    const qx = `abs(X-W*${centerX})-W*${halfWidth}+(${radius})`;
    const qy = `abs(Y-H*${centerY})-H*${halfHeight}+(${radius})`;
    distance = `sqrt(pow(max(${qx},0),2)+pow(max(${qy},0),2))+min(max(${qx},${qy}),0)-(${radius})`;
    featherBase = `min(W*${width},H*${height})`;
  }
  const feather = Number(mask.feather ?? 0);
  const alpha = feather > 0
    ? `clip(0.5-(${distance})/(2*(${featherBase})*${graphNumber(feather / 400)}),0,1)`
    : `if(lte(${distance},0),1,0)`;
  return mask.inverted === true ? `1-(${alpha})` : alpha;
}

function visualMaskFilter(mask) {
  const alpha = visualMaskAlphaExpression(mask);
  return alpha
    ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha})'`
    : "";
}

function addStickerOverlays({ args, filters, inputs, stickers, media, extractedFiles, width, height, frameRate, inputLabel }) {
  const baseSize = Math.max(1, Math.min(width, height) * 0.22);
  return stickers.reduce((baseLabel, segment, index) => {
    const path = resolveStickerPath(segment, media, extractedFiles);
    const start = Math.max(0, finiteNumber(segment.start));
    const duration = Math.max(0.001, finiteNumber(segment.duration));
    const inputIndex = inputs.count++;
    const animated = segment.animated === true || /\.(?:gif|webp)$/iu.test(path);
    if (animated) args.push("-stream_loop", "-1", "-t", String(duration), "-i", path);
    else args.push("-loop", "1", "-t", String(duration), "-i", path);
    const keyframes = normalizeRenderVisualKeyframes(segment.keyframes || []);
    const localScale = visualFieldExpression(segment, keyframes, "scale", "t");
    const localRotation = visualFieldExpression(segment, keyframes, "rotation", "t");
    const localOpacity = visualFieldExpression(segment, keyframes, "opacity", "T");
    const widthExpression = `if(gte(iw/ih,1),${graphNumber(baseSize)}*(${localScale}),${graphNumber(baseSize)}*(${localScale})*iw/ih)`;
    const heightExpression = `if(gte(iw/ih,1),${graphNumber(baseSize)}*(${localScale})/(iw/ih),${graphNumber(baseSize)}*(${localScale}))`;
    const stickerLabel = `[sticker${index}]`;
    filters.push(`[${inputIndex}:v]scale=w='max(2,trunc((${widthExpression})/2)*2)':h='max(2,trunc((${heightExpression})/2)*2)':eval=frame,rotate=angle='PI/180*(${localRotation})':ow=rotw(iw):oh=roth(ih):c=none,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${localOpacity})',fps=${frameRate},setpts=PTS-STARTPTS+${graphNumber(start)}/TB${stickerLabel}`);
    const localTimelineTime = start === 0 ? "t" : `(t-${graphNumber(start)})`;
    const x = visualFieldExpression(segment, keyframes, "x", localTimelineTime);
    const y = visualFieldExpression(segment, keyframes, "y", localTimelineTime);
    const outputLabel = `[vsticker${index}]`;
    filters.push(`${baseLabel}${stickerLabel}overlay=x='(${x})/100*W-w/2':y='(${y})/100*H-h/2':eval=frame:eof_action=pass:repeatlast=0:enable='gte(t,${graphNumber(start)})*lt(t,${graphNumber(start + duration)})'${outputLabel}`);
    return outputLabel;
  }, inputLabel);
}

function addVisualOverlays({ args, filters, inputs, overlays, media, extractedFiles, width, height, frameRate, inputLabel }) {
  return overlays.reduce((baseLabel, segment, index) => {
    const path = resolveOverlayPath(segment, media, extractedFiles);
    const overlayDuration = finitePositive(segment.duration, `Visual overlay ${segment.id} duration`);
    const start = Math.max(0, finiteNumber(segment.start));
    const inputIndex = inputs.count++;
    if (segment.type === "image") args.push("-loop", "1", "-t", String(overlayDuration), "-i", path);
    else args.push("-i", path);
    const remappedInput = segment.type === "video"
      ? addRemappedVideoSource({ filters, inputIndex, segment, prefix: `voverlayremap${index}`, frameRate })
      : null;
    const visualInput = remappedInput || `[${inputIndex}:v]`;
    const sourceStart = Math.max(0, finiteNumber(segment.sourceStart));
    const rate = Math.max(0.25, Math.min(4, finiteNumber(segment.playbackRate, 1)));
    const sourceDuration = Math.max(0.001, finiteNumber(segment.sourceDuration, overlayDuration * rate));
    const transform = segment.baseTransform || {};
    const keyframes = normalizeRenderVisualKeyframes(segment.keyframes || []);
    const dynamic = keyframes.length > 0 || hasVisualAnimation(segment.animation);
    const x = finiteNumber(transform.x);
    const y = finiteNumber(transform.y);
    const rawScale = finiteNumber(transform.scale, 1);
    const scale = Math.max(0.1, rawScale === 0 ? 1 : rawScale);
    const rotation = finiteNumber(transform.rotation);
    const opacity = Math.max(0, Math.min(1, finiteNumber(transform.opacity, 1)));
    const scaledWidth = Math.max(2, Math.round(width * scale / 2) * 2);
    const scaledHeight = Math.max(2, Math.round(height * scale / 2) * 2);
    const trim = segment.type === "video" && !remappedInput
      ? `trim=start=${graphNumber(sourceStart)}:duration=${graphNumber(sourceDuration)},setpts=(PTS-STARTPTS)/${graphNumber(rate)},`
      : "";
    const dynamicScale = animatedVisualFieldExpression(transform, keyframes, segment.animation, overlayDuration, "scale", "t");
    const dynamicRotation = visualFieldExpression(transform, keyframes, "rotation", "t");
    const dynamicOpacity = animatedVisualFieldExpression(transform, keyframes, segment.animation, overlayDuration, "opacity", "T");
    const rotate = dynamic
      ? `,rotate=angle='PI/180*(${dynamicRotation})':ow=rotw(iw):oh=roth(ih):c=none`
      : Math.abs(rotation) > 1e-9
        ? `,rotate=angle=${graphNumber(rotation)}*PI/180:ow=rotw(iw):oh=roth(ih):c=none`
        : "";
    const overlayLabel = `[overlay${index}]`;
    const mask = visualMaskFilter(segment.mask);
    const visualFilter = [
      visualFilterChain(segment.filterId),
      buildRegisteredEffectFfmpegChain(segment.effects, { mediaType: segment.type }),
    ].filter(Boolean).join(",");
    const colorGradeFilter = buildFfmpegColorGradeFilter(segment.colorGrade, segment.keyframes, "T");
    const colorGradeSuffix = colorGradeFilter ? `,${colorGradeFilter}` : "";
    const transformFilters = dynamic
      ? `scale=w='max(2,trunc(iw*(${dynamicScale})/2)*2)':h='max(2,trunc(ih*(${dynamicScale})/2)*2)':eval=frame${rotate},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${dynamicOpacity})'`
      : `scale=${scaledWidth}:${scaledHeight}${rotate},colorchannelmixer=aa=${graphNumber(opacity)}`;
    filters.push(`${visualInput}${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba${visualFilter ? `,${visualFilter}` : ""}${colorGradeSuffix}${mask},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=${frameRate},setsar=1,${transformFilters},setpts=PTS-STARTPTS+${graphNumber(start)}/TB${overlayLabel}`);
    const outputLabel = `[vcomposite${index}]`;
    if (dynamic) {
      const localTime = start === 0 ? "t" : `(t-${graphNumber(start)})`;
      const xExpression = animatedVisualFieldExpression(transform, keyframes, segment.animation, overlayDuration, "x", localTime);
      const yExpression = animatedVisualFieldExpression(transform, keyframes, segment.animation, overlayDuration, "y", localTime);
      filters.push(`${baseLabel}${overlayLabel}overlay=x='(W-w)/2+(${xExpression})/100*W':y='(H-h)/2+(${yExpression})/100*H':eval=frame:eof_action=pass:repeatlast=0:enable='between(t,${graphNumber(start)},${graphNumber(start + overlayDuration)})'${outputLabel}`);
    } else {
      const xOffset = graphNumber(x / 100 * width);
      const yOffset = graphNumber(y / 100 * height);
      filters.push(`${baseLabel}${overlayLabel}overlay=x=(W-w)/2${x < 0 ? "" : "+"}${xOffset}:y=(H-h)/2${y < 0 ? "" : "+"}${yOffset}:eof_action=pass:repeatlast=0:enable='between(t,${graphNumber(start)},${graphNumber(start + overlayDuration)})'${outputLabel}`);
    }
    return outputLabel;
  }, inputLabel);
}

function addAudioTrack({ args, filters, inputs, segments, mediaEntry, mediaEntries = [], extractedFiles, duration, prefix, defaultVolume = 1 }) {
  if (!segments.length) return [];
  return segments.filter(segment => segment.muted !== true && Number(segment.volume ?? defaultVolume) !== 0).map((segment, index) => {
    if (segment.availableSourceDuration !== undefined && segment.availableSourceDuration < segment.sourceDuration) throw renderError("INVALID_PROJECT", "Speed curve extends beyond the saved source audio; repair the source range before rendering");
    const segmentEntry = mediaEntries.find((entry) => [segment.id, segment.archiveMediaId].includes(entry.id)) || mediaEntry;
    const path = segmentEntry?.path ? extractedFiles.get(segmentEntry.path) : null;
    if (!path) throw renderError("MISSING_MEDIA", `Portable media is missing for ${prefix} clip: ${segment.id}`);
    const inputIndex = inputs.count++;
    const loop = segment.vibedevLoop === true;
    if (loop) args.push("-stream_loop", "-1");
    args.push("-i", path);
    const rate = Math.max(0.25, Math.min(4, Number(segment.playbackRate) || 1));
    const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
    const segmentDuration = finitePositive(segment.duration, `${prefix} duration`);
    const sourceDuration = loop
      ? segmentDuration * rate
      : Math.max(0.001, Number(segment.sourceDuration) || segmentDuration * rate);
    const start = Math.max(0, Number(segment.start) || 0);
    const volume = Math.max(0, Math.min(4, Number.isFinite(Number(segment.volume)) ? Number(segment.volume) : defaultVolume));
    const fadeIn = Math.min(segmentDuration / 2, Math.max(0, Number(segment.fadeIn) || 0));
    const fadeOut = Math.min(segmentDuration / 2, Math.max(0, Number(segment.fadeOut) || 0));
    const label = `${prefix}${index}`;
    const tempo = Math.abs(rate - 1) < 1e-6 ? "" : `${atempoChain(rate)},`;
    const remappedSource = addRemappedAudioSource({
      filters,
      inputIndex,
      segment,
      prefix: `${label}remap`,
    });
    const fades = [
      fadeIn > 0 ? `afade=t=in:st=0:d=${graphNumber(fadeIn)}` : "",
      fadeOut > 0 ? `afade=t=out:st=${graphNumber(segmentDuration - fadeOut)}:d=${graphNumber(fadeOut)}` : "",
    ].filter(Boolean).join(",");
    const envelope = volumeEnvelopeExpression(segment.volumeEnvelope, segmentDuration);
    const automation = envelope ? `,volume='${envelope}':eval=frame` : "";
    const preset = getAudioSpatialEffect(segment.spatialEffect);
    const spatialAmount = normalizeAudioSpatialAmount(segment.spatialAmount);
    // Rebuild sample timestamps after adelay: newer FFmpeg can emit the first
    // silent frame without PTS, which otherwise makes atrim remove the delay.
    if (preset.id === "original" || spatialAmount <= 0) {
      if (remappedSource) {
        filters.push(`${remappedSource}${fades || "anull"},volume=${volume}${automation},adelay=${Math.round(start * 1000)}:all=1,asetpts=N/SR/TB,apad,atrim=duration=${duration}[${label}]`);
      } else {
        filters.push(`[${inputIndex}:a]atrim=start=${sourceStart}:duration=${sourceDuration},asetpts=PTS-STARTPTS,${tempo}atrim=duration=${graphNumber(segmentDuration)}${fades ? `,${fades}` : ""},volume=${volume}${automation},adelay=${Math.round(start * 1000)}:all=1,asetpts=N/SR/TB,apad,atrim=duration=${duration}[${label}]`);
      }
      return `[${label}]`;
    }

    const sourceLabel = `[${label}source]`;
    const dryInputLabel = `[${label}spatialdryin]`;
    const wetInputLabel = `[${label}spatialwetin]`;
    const dryLabel = `[${label}spatialdry]`;
    const wetLabel = `[${label}spatialwet]`;
    const spatialLabel = `[${label}spatial]`;
    const dryGain = 1 - spatialAmount * (1 - preset.dry);
    const wetGain = preset.wet * spatialAmount;
    const outputGain = 1 - spatialAmount * (1 - preset.output);
    const diffuseTail = Array.from({ length: 16 }, (_, tailIndex) => {
      const progress = (tailIndex + 1) / 16;
      return [
        preset.duration * progress,
        0.004 + 0.04 * Math.pow(1 - progress, preset.decay),
      ];
    });
    const echoes = [
      ...preset.reflections,
      ...diffuseTail,
    ]
      .map(([seconds, gain]) => [Math.max(1, Math.round(seconds * 1000)), Math.max(0.001, Math.min(0.99, gain))])
      .filter(([delay], index, values) => values.findIndex(([candidate]) => candidate === delay) === index);
    const echoDelays = echoes.map(([delay]) => delay).join("|");
    const echoDecays = echoes.map(([, gain]) => graphNumber(gain)).join("|");
    const wetDuration = segmentDuration + preset.preDelay + preset.duration;

    if (remappedSource) filters.push(`${remappedSource}anull${sourceLabel}`);
    else filters.push(`[${inputIndex}:a]atrim=start=${sourceStart}:duration=${sourceDuration},asetpts=PTS-STARTPTS,${tempo}atrim=duration=${graphNumber(segmentDuration)},aformat=sample_rates=48000:channel_layouts=stereo${sourceLabel}`);
    filters.push(`${sourceLabel}asplit=2${dryInputLabel}${wetInputLabel}`);
    filters.push(`${dryInputLabel}volume=${graphNumber(dryGain)}${dryLabel}`);
    filters.push(`${wetInputLabel}adelay=${Math.round(preset.preDelay * 1000)}:all=1,apad=pad_dur=${graphNumber(preset.duration)},aecho=1:1:${echoDelays}:${echoDecays},lowpass=f=${graphNumber(preset.tone)},atrim=duration=${graphNumber(wetDuration)},volume=${graphNumber(wetGain)}${wetLabel}`);
    filters.push(`${dryLabel}${wetLabel}amix=inputs=2:duration=longest:normalize=0,asetpts=N/SR/TB,volume=${graphNumber(outputGain)}${spatialLabel}`);
    filters.push(`${spatialLabel}${fades || "anull"},volume=${volume}${automation},adelay=${Math.round(start * 1000)}:all=1,asetpts=N/SR/TB,apad,atrim=duration=${duration}[${label}]`);
    return `[${label}]`;
  });
}

function volumeEnvelopeExpression(value, duration) {
  const points = Array.isArray(value) ? value : [];
  if (!points.length) return "";
  let previous = -1;
  const normalized = points.map((point) => {
    const time = Number(point?.time);
    const gain = Number(point?.gain);
    if (!Number.isFinite(time) || time < 0 || time > duration || time <= previous
      || !Number.isFinite(gain) || gain < 0 || gain > 4) {
      throw renderError("INVALID_PROJECT", "BGM volume envelope is invalid");
    }
    previous = time;
    return { time, gain };
  });
  if (normalized.length === 1) return graphNumber(normalized[0].gain);
  let expression = graphNumber(normalized.at(-1).gain);
  for (let index = normalized.length - 2; index >= 0; index -= 1) {
    const from = normalized[index];
    const to = normalized[index + 1];
    const interpolation = `${graphNumber(from.gain)}+(${graphNumber(to.gain - from.gain)})*(t-${graphNumber(from.time)})/${graphNumber(to.time - from.time)}`;
    expression = `if(lt(t,${graphNumber(to.time)}),${interpolation},${expression})`;
  }
  return expression;
}

function validateMusicDucking(value) {
  if (!value || value.enabled !== true) return null;
  const fields = {
    threshold: [0.001, 1, 0.05], floorGain: [0.01, 1, 0.2],
    attackMs: [0.1, 2000, 5], releaseMs: [10, 9000, 300],
  };
  if (value.speechBus !== "voiceover") {
    throw renderError("INVALID_PROJECT", "BGM ducking requires the voiceover speech bus");
  }
  const result = { enabled: true, speechBus: "voiceover" };
  Object.entries(fields).forEach(([key, [minimum, maximum, fallback]]) => {
    const candidate = value[key] == null ? fallback : Number(value[key]);
    if (!Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
      throw renderError("INVALID_PROJECT", `BGM ducking ${key} must be between ${minimum} and ${maximum}`);
    }
    result[key] = candidate;
  });
  return result;
}

function renderTransitionFilter({ id, left, right, duration, offset, output, index }) {
  const transition = TRANSITION_XFADE_IDS[id];
  if (transition) {
    return [`${left}${right}xfade=transition=${transition}:duration=${duration}:offset=${offset},trim=duration=${offset + duration},setpts=PTS-STARTPTS${output}`];
  }
  if (id !== "glitch") {
    throw renderError("UNSUPPORTED_RENDER_FEATURE", `Unsupported transition: ${id}`);
  }

  const leftRgb = `[vglitch${index}left]`;
  const rightRgb = `[vglitch${index}right]`;
  const pulse = "max(0,sin(P*PI*8))*0.12";
  // gbrp plane order is green, blue, red. The fork preview overlays #35ead9
  // during the transition; apply the same pulse after the ordinary crossfade.
  const cyanPlane = "if(eq(PLANE,0),234,if(eq(PLANE,1),217,53))";
  const blend = "(A*(1-P)+B*P)";
  const expression = `clip(${blend}*(1-(${pulse}))+(${cyanPlane})*(${pulse}),0,255)`;
  return [
    `${left}format=gbrp${leftRgb}`,
    `${right}format=gbrp${rightRgb}`,
    `${leftRgb}${rightRgb}xfade=transition=custom:duration=${duration}:offset=${offset}:expr='${expression}',format=yuv420p,trim=duration=${offset + duration},setpts=PTS-STARTPTS${output}`,
  ];
}

export function buildFfmpegRenderPlan({ project, media = {}, extractedFiles, settings = {}, rendererResources = {} }) {
  if (!(extractedFiles instanceof Map)) throw renderError("INVALID_ARGUMENT", "extractedFiles must be a Map");
  assertSupportedProject(project || {});
  const requirements = getFfmpegRenderMediaRequirements(project || {});
  const visuals = requirements.visuals;
  if (!visuals.length) throw renderError("EMPTY_TIMELINE", "Headless render requires at least one visual clip");
  const ratio = RATIO_SIZES[project.ratioId] || RATIO_SIZES["16:9"];
  const width = evenDimension(settings.width, ratio.width, "width");
  const height = evenDimension(settings.height, ratio.height, "height");
  const frameRate = Math.max(1, Math.min(60, Math.round(Number(settings.frameRate) || 30)));
  const targetLoudnessLufs = project.targetLoudnessLufs == null
    ? -14
    : Number(project.targetLoudnessLufs);
  if (!Number.isFinite(targetLoudnessLufs) || targetLoudnessLufs < -24 || targetLoudnessLufs > -6) {
    throw renderError("INVALID_PROJECT", "target loudness must be between -24 and -6 LUFS");
  }
  const duration = visuals.reduce((sum, segment) => sum + finitePositive(segment.duration, `Visual clip ${segment.id} duration`), 0);
  const junctions = visuals.map((segment, index) => {
    const id = segment.transition?.id;
    if (!id || id === "none") return null;
    if (index >= visuals.length - 1) throw renderError("INVALID_PROJECT", `Visual clip ${segment.id} cannot transition without a following clip`);
    const transitionDuration = finitePositive(segment.transition?.duration || 0.5, `Transition after ${segment.id} duration`);
    const nextDuration = finitePositive(visuals[index + 1].duration, `Visual clip ${visuals[index + 1].id} duration`);
    if (transitionDuration >= Math.min(Number(segment.duration), nextDuration)) {
      throw renderError("INVALID_PROJECT", `Transition after ${segment.id} must be shorter than both clips`);
    }
    return { id, duration: transitionDuration };
  });
  const args = ["-hide_banner", "-y"];
  const filters = [];
  const inputs = { count: 0 };
  const videoLabels = visuals.map((segment, index) => {
    const path = resolveVisualPath(segment, media, extractedFiles);
    const clipDuration = Number(segment.duration);
    const inputIndex = inputs.count++;
    if (segment.type === "image") args.push("-loop", "1", "-t", String(clipDuration), "-i", path);
    else args.push("-i", path);
    const remappedInput = segment.type === "video"
      ? addRemappedVideoSource({ filters, inputIndex, segment, prefix: `vremap${index}`, frameRate })
      : null;
    const visualInput = remappedInput || `[${inputIndex}:v]`;
    const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
    const rate = Math.max(0.25, Math.min(4, Number(segment.playbackRate) || 1));
    const trim = segment.type === "video" && !remappedInput ? `trim=start=${sourceStart}:duration=${clipDuration * rate},setpts=(PTS-STARTPTS)/${rate},` : "";
    const visualFilter = [
      visualFilterChain(segment.filterId || project.selectedFilterId),
      buildRegisteredEffectFfmpegChain(segment.effects, { mediaType: segment.type }),
    ].filter(Boolean).join(",");
    const visualFilterSuffix = visualFilter ? `,${visualFilter}` : "";
    const colorGradeFilter = buildFfmpegColorGradeFilter(segment.colorGrade, segment.keyframes, "T");
    const colorGradeSuffix = colorGradeFilter ? `,${colorGradeFilter}` : "";
    const keyframes = normalizeRenderVisualKeyframes(segment.keyframes || []);
    const mask = visualMaskFilter(segment.mask);
    const subjectEffectLabel = addSubjectEffectSource({
      args, filters, inputs, segment, index, visualInput, trim, visualFilterSuffix,
      colorGradeSuffix, media, extractedFiles, width, height, frameRate, clipDuration,
    });
    if (subjectEffectLabel) return subjectEffectLabel;
    const depthEffectLabel = addDepthEffectSource({
      args, filters, inputs, segment, index, visualInput, trim, visualFilterSuffix,
      colorGradeSuffix, media, extractedFiles, width, height, frameRate, clipDuration,
    });
    if (depthEffectLabel) return depthEffectLabel;
    const hasTransform = segment.baseTransform != null || keyframes.length > 0 || hasVisualAnimation(segment.animation) || Boolean(mask);
    if (!hasTransform) {
      filters.push(`${visualInput}${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black${visualFilterSuffix}${colorGradeSuffix},fps=${frameRate},setsar=1,format=yuv420p[v${index}]`);
      return `[v${index}]`;
    }

    const transform = segment.baseTransform || {};
    const scale = animatedVisualFieldExpression(transform, keyframes, segment.animation, clipDuration, "scale", "t");
    const rotation = visualFieldExpression(transform, keyframes, "rotation", "t");
    const opacity = animatedVisualFieldExpression(transform, keyframes, segment.animation, clipDuration, "opacity", "T");
    const x = animatedVisualFieldExpression(transform, keyframes, segment.animation, clipDuration, "x", "t");
    const y = animatedVisualFieldExpression(transform, keyframes, segment.animation, clipDuration, "y", "t");
    const sourceLabel = `[vprimarysource${index}]`;
    const layerLabel = `[vprimarylayer${index}]`;
    const backgroundLabel = `[vprimarybg${index}]`;
    filters.push(`${visualInput}${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0${visualFilterSuffix}${colorGradeSuffix}${mask},fps=${frameRate},setsar=1,setpts=PTS-STARTPTS${sourceLabel}`);
    filters.push(`${sourceLabel}scale=w='max(2,trunc(iw*(${scale})/2)*2)':h='max(2,trunc(ih*(${scale})/2)*2)':eval=frame,rotate=angle='PI/180*(${rotation})':ow=rotw(iw):oh=roth(ih):c=none,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacity})'${layerLabel}`);
    filters.push(`color=c=black:s=${width}x${height}:r=${frameRate}:d=${graphNumber(clipDuration)},format=rgba${backgroundLabel}`);
    filters.push(`${backgroundLabel}${layerLabel}overlay=x='(W-w)/2+(${x})/100*W':y='(H-h)/2+(${y})/100*H':eval=frame:eof_action=pass:repeatlast=0,format=yuv420p[v${index}]`);
    return `[v${index}]`;
  });
  const mainLabels = [...videoLabels];
  const previewLabels = new Array(videoLabels.length).fill(null);
  junctions.forEach((junction, index) => {
    if (!junction) return;
    const nextIndex = index + 1;
    const main = `[v${nextIndex}main]`;
    const preview = `[v${nextIndex}preview]`;
    filters.push(`${videoLabels[nextIndex]}split=2${main}${preview}`);
    mainLabels[nextIndex] = main;
    previewLabels[nextIndex] = preview;
  });
  const renderedVideoLabels = mainLabels.map((label, index) => {
    const junction = junctions[index];
    if (!junction) return label;
    const clipDuration = Number(visuals[index].duration);
    const output = `[vjunction${index}]`;
    filters.push(...renderTransitionFilter({
      id: junction.id,
      left: label,
      right: previewLabels[index + 1],
      duration: junction.duration,
      offset: clipDuration - junction.duration,
      output,
      index,
    }));
    return output;
  });
  const captionAss = buildCaptionAss(project, width, height, duration, rendererResources);
  const overlays = requirements.overlays;
  const stickers = requirements.stickers;
  const needsPostProcessing = stickers.length > 0 || overlays.length > 0 || captionAss;
  filters.push(`${renderedVideoLabels.join("")}concat=n=${renderedVideoLabels.length}:v=1:a=0${needsPostProcessing ? "[vbase]" : "[vout]"}`);
  const stickerLabel = addStickerOverlays({
    args, filters, inputs, stickers, media, extractedFiles, width, height, frameRate, inputLabel: "[vbase]",
  });
  const compositedLabel = addVisualOverlays({
    args, filters, inputs, overlays, media, extractedFiles, width, height, frameRate, inputLabel: stickerLabel,
  });
  if (captionAss) filters.push(`${compositedLabel}subtitles=filename=captions.ass${captionAss.fontSidecars.length ? ":fontsdir=." : ""}[vout]`);
  else if (stickers.length > 0 || overlays.length > 0) filters.push(`${compositedLabel}null[vout]`);

  const voiceLabels = addAudioTrack({ args, filters, inputs, segments: requirements.audioSegments, mediaEntry: media.audio, mediaEntries: media.audioSegments || [], extractedFiles, duration, prefix: "voice" });
  const musicVolume = Number.isFinite(Number(project.musicVolume)) ? Number(project.musicVolume) : 0.35;
  const musicLabels = addAudioTrack({ args, filters, inputs, segments: requirements.musicSegments, mediaEntry: media.music, extractedFiles, duration, prefix: "music", defaultVolume: musicVolume });
  // FORK: the clips' own sound, mixed in with the voices and the music. It is
  // not the ducking key — the browser ducks music under the voiceover only.
  const sourceLabels = addAudioTrack({
    args, filters, inputs, segments: sourceAudioSegmentsForRender(project, media.sourceAudioSegments || []),
    mediaEntries: media.sourceAudioSegments || [], extractedFiles, duration, prefix: "source",
  });
  let audioLabels = [...voiceLabels, ...musicLabels, ...sourceLabels];
  const ducking = requirements.musicSegments
    .map((segment) => validateMusicDucking(segment.ducking))
    .find(Boolean);
  if (ducking && voiceLabels.length && musicLabels.length) {
    const mixBus = (labels, output) => {
      filters.push(labels.length === 1
        ? `${labels[0]}anull${output}`
        : `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0${output}`);
    };
    mixBus(voiceLabels, "[voicebus]");
    mixBus(musicLabels, "[musicbus]");
    filters.push("[voicebus]asplit=2[voicekey][voicepass]");
    const threshold = ducking.threshold;
    const floorGain = ducking.floorGain;
    const reductionDb = -20 * Math.log10(floorGain);
    const ratio = Math.max(1, Math.min(20, 1 + reductionDb * 7 / 12));
    const attack = ducking.attackMs;
    const release = ducking.releaseMs;
    filters.push(`[musicbus][voicekey]sidechaincompress=threshold=${graphNumber(threshold)}:ratio=${graphNumber(ratio)}:attack=${graphNumber(attack)}:release=${graphNumber(release)}[musicducked]`);
    audioLabels = ["[voicepass]", "[musicducked]", ...sourceLabels];
  }
  if (audioLabels.length) {
    const mixedAudio = audioLabels.length === 1
      ? `${audioLabels[0]}anull`
      : `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,asetpts=N/SR/TB`;
    filters.push(`${mixedAudio},atrim=duration=${duration},loudnorm=I=${targetLoudnessLufs}:TP=-1.5:LRA=11,aeval=exprs='if(isnan(val(ch))+isinf(val(ch)),0,val(ch))':c=same,aresample=48000[aout]`);
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
  if (audioLabels.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", settings.preset || "medium", "-crf", String(Number(settings.crf) || 18), "-pix_fmt", "yuv420p", "-r", String(frameRate), "-t", String(duration), "-movflags", "+faststart");
  return {
    args,
    duration,
    width,
    height,
    frameRate,
    hasAudio: audioLabels.length > 0,
    targetLoudnessLufs,
    ...(captionAss ? { sidecars: [{ filename: "captions.ass", content: captionAss.content }, ...captionAss.fontSidecars] } : {}),
  };
}

const DEFAULT_WHEEL = Object.freeze({ hue: 0, saturation: 0, luminance: 0 });

export const COLOR_GRADE_KEYFRAME_KEYS = Object.freeze([
  "colorGrade.temperature",
  "colorGrade.tint",
  "colorGrade.saturation",
  ...["shadows", "midtones", "highlights", "offset"].flatMap((wheel) => [
    `colorGrade.${wheel}.hue`,
    `colorGrade.${wheel}.saturation`,
    `colorGrade.${wheel}.luminance`,
  ]),
]);

export const DEFAULT_COLOR_GRADE = Object.freeze({
  temperature: 0,
  tint: 0,
  saturation: 0,
  shadows: DEFAULT_WHEEL,
  midtones: DEFAULT_WHEEL,
  highlights: DEFAULT_WHEEL,
  offset: DEFAULT_WHEEL,
});

function clamp(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeHue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return ((number % 360) + 360) % 360;
}

function normalizeWheel(value = {}) {
  return {
    hue: normalizeHue(value.hue),
    saturation: clamp(value.saturation, 0, 100),
    luminance: clamp(value.luminance, -100, 100),
  };
}

export function getColorGradeProperty(value = {}, key = "") {
  const path = String(key).replace(/^colorGrade\./, "").split(".");
  return path.reduce((current, part) => current?.[part], normalizeColorGrade(value));
}

export function normalizeColorGradeProperty(key, value) {
  if (key.endsWith(".hue")) return normalizeHue(value);
  return clamp(value, -100, 100);
}

function setColorGradeProperty(value, key, nextValue) {
  const grade = normalizeColorGrade(value);
  const path = String(key).replace(/^colorGrade\./, "").split(".");
  if (path.length === 1) return normalizeColorGrade({ ...grade, [path[0]]: nextValue });
  return normalizeColorGrade({ ...grade, [path[0]]: { ...grade[path[0]], [path[1]]: nextValue } });
}

export function resolveColorGrade(keyframes = [], time = 0, baseColorGrade = {}) {
  const safeTime = Math.max(0, Number(time) || 0);
  return COLOR_GRADE_KEYFRAME_KEYS.reduce((grade, key) => {
    const frames = keyframes
      .filter((frame) => frame && Number.isFinite(Number(frame.time)) && Number.isFinite(Number(frame[key])))
      .map((frame) => ({ time: Math.max(0, Number(frame.time) || 0), value: normalizeColorGradeProperty(key, frame[key]) }))
      .sort((left, right) => left.time - right.time);
    if (!frames.length || safeTime < frames[0].time) return grade;
    if (safeTime >= frames.at(-1).time) return setColorGradeProperty(grade, key, frames.at(-1).value);
    const rightIndex = frames.findIndex((frame) => frame.time >= safeTime);
    if (rightIndex <= 0) return setColorGradeProperty(grade, key, frames[0].value);
    const left = frames[rightIndex - 1];
    const right = frames[rightIndex];
    const progress = (safeTime - left.time) / Math.max(0.0001, right.time - left.time);
    let delta = right.value - left.value;
    if (key.endsWith(".hue")) delta = ((delta + 540) % 360) - 180;
    return setColorGradeProperty(grade, key, left.value + delta * progress);
  }, normalizeColorGrade(baseColorGrade));
}

export function normalizeColorGrade(value = {}) {
  return {
    temperature: clamp(value.temperature, -100, 100),
    tint: clamp(value.tint, -100, 100),
    saturation: clamp(value.saturation, -100, 100),
    shadows: normalizeWheel(value.shadows),
    midtones: normalizeWheel(value.midtones),
    highlights: normalizeWheel(value.highlights),
    offset: normalizeWheel(value.offset),
  };
}

export function isColorGradeNeutral(value = {}) {
  const grade = normalizeColorGrade(value);
  return grade.temperature === 0
    && grade.tint === 0
    && grade.saturation === 0
    && [grade.shadows, grade.midtones, grade.highlights, grade.offset].every((wheel) => (
      wheel.saturation === 0 && wheel.luminance === 0
    ));
}

function round(value, precision = 4) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

export function getColorGradeFilterCss(value = {}) {
  const grade = normalizeColorGrade(value);
  if (isColorGradeNeutral(grade)) return "none";

  const wheels = [
    [grade.shadows, 0.34],
    [grade.midtones, 0.42],
    [grade.highlights, 0.24],
    [grade.offset, 0.56],
  ];
  let vectorX = 0;
  let vectorY = 0;
  let luminance = 0;
  wheels.forEach(([wheel, weight]) => {
    const radians = wheel.hue * Math.PI / 180;
    const amount = wheel.saturation / 100 * weight;
    vectorX += Math.cos(radians) * amount;
    vectorY += Math.sin(radians) * amount;
    luminance += wheel.luminance / 100 * weight;
  });

  const chroma = Math.min(1, Math.hypot(vectorX, vectorY));
  const hue = chroma > 0.0001 ? Math.atan2(vectorY, vectorX) * 180 / Math.PI : 0;
  const temperatureWarmth = Math.max(0, grade.temperature) / 100;
  const temperatureCool = Math.max(0, -grade.temperature) / 100;
  const sepia = Math.min(0.34, temperatureWarmth * 0.2 + chroma * 0.26);
  const hueRotate = hue * chroma + grade.tint * 0.18 + temperatureCool * 188;
  const brightness = Math.max(0.72, 1 + luminance * 0.24 + grade.offset.luminance * 0.0014 + grade.temperature * 0.0003);
  const contrast = Math.max(0.78, 1 + (grade.highlights.luminance - grade.shadows.luminance) * 0.0011);
  const saturation = Math.max(0, 1 + grade.saturation / 100 + chroma * 0.42);

  return [
    `brightness(${round(brightness)})`,
    `contrast(${round(contrast)})`,
    `saturate(${round(saturation)})`,
    sepia > 0.0001 ? `sepia(${round(sepia)})` : "",
    Math.abs(hueRotate) > 0.001 ? `hue-rotate(${round(hueRotate, 2)}deg)` : "",
  ].filter(Boolean).join(" ");
}

export function composeColorGradeFilter(baseFilter = "none", colorGrade = {}) {
  const base = typeof baseFilter === "string" && baseFilter.trim() && baseFilter !== "none"
    ? baseFilter.trim()
    : "";
  const grade = getColorGradeFilterCss(colorGrade);
  return [base, grade === "none" ? "" : grade].filter(Boolean).join(" ") || "none";
}

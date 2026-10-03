import {
  getColorGradeProperty,
  isColorGradeNeutral,
  normalizeColorGrade,
  normalizeColorGradeProperty,
} from "./colorGrade.js";

const WHEEL_WEIGHTS = Object.freeze({
  shadows: 0.34,
  midtones: 0.42,
  highlights: 0.24,
  offset: 0.56,
});

function number(value) {
  const rounded = Math.round(Number(value) * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function propertyExpression(baseGrade, keyframes, key, timeExpression) {
  const base = normalizeColorGradeProperty(key, getColorGradeProperty(baseGrade, key));
  const points = (keyframes || [])
    .filter((frame) => frame && Number.isFinite(Number(frame.time)) && Number.isFinite(Number(frame[key])))
    .map((frame) => ({
      time: Math.max(0, Number(frame.time) || 0),
      value: normalizeColorGradeProperty(key, frame[key]),
    }))
    .sort((left, right) => left.time - right.time);
  if (!points.length) return number(base);

  const unwrapped = [];
  points.forEach((point, index) => {
    if (!key.endsWith(".hue") || index === 0) {
      unwrapped.push({ ...point });
      return;
    }
    const previousRaw = points[index - 1];
    const previous = unwrapped[index - 1];
    const delta = ((point.value - previousRaw.value + 540) % 360) - 180;
    unwrapped.push({ ...point, value: previous.value + delta });
  });
  let expression = number(unwrapped.at(-1).value);
  for (let index = unwrapped.length - 2; index >= 0; index -= 1) {
    const left = unwrapped[index];
    const right = unwrapped[index + 1];
    const duration = Math.max(0.0001, right.time - left.time);
    const interpolated = Math.abs(right.value - left.value) < 1e-9
      ? number(left.value)
      : `(${number(left.value)}+(${number(right.value - left.value)})*((${timeExpression}-${number(left.time)})/${number(duration)}))`;
    expression = `if(lte(${timeExpression},${number(right.time)}),${interpolated},${expression})`;
  }
  const first = unwrapped[0];
  return first.time > 0
    ? `if(lt(${timeExpression},${number(first.time)}),${number(base)},${expression})`
    : expression;
}

function rgbGeq(red, green, blue) {
  return `geq=r='clip(${red},0,255)':g='clip(${green},0,255)':b='clip(${blue},0,255)'`;
}

/** Compile the exact CSS-filter order used by getColorGradeFilterCss() into
 * frame-evaluated RGB expressions. The individual grade properties use the
 * same normalization and shortest-path hue interpolation as the preview. */
export function buildFfmpegColorGradeFilter(colorGrade = {}, keyframes = [], timeExpression = "T") {
  const grade = normalizeColorGrade(colorGrade);
  const hasKeyframes = (keyframes || []).some((frame) => (
    frame && Object.keys(frame).some((key) => key.startsWith("colorGrade."))
  ));
  if (isColorGradeNeutral(grade) && !hasKeyframes) return "";
  const derived = (clock) => {
    const value = (key) => propertyExpression(grade, keyframes, `colorGrade.${key}`, clock);
    const temperature = value("temperature");
    const tint = value("tint");
    const authoredSaturation = value("saturation");
    const wheel = {};
    for (const [name, weight] of Object.entries(WHEEL_WEIGHTS)) {
      wheel[name] = {
        hue: value(`${name}.hue`),
        saturation: value(`${name}.saturation`),
        luminance: value(`${name}.luminance`),
        weight: number(weight),
      };
    }
    const vectorX = `(${Object.values(wheel).map((entry) => `cos((${entry.hue})*PI/180)*((${entry.saturation})/100)*${entry.weight}`).join("+")})`;
    const vectorY = `(${Object.values(wheel).map((entry) => `sin((${entry.hue})*PI/180)*((${entry.saturation})/100)*${entry.weight}`).join("+")})`;
    const luminance = `(${Object.values(wheel).map((entry) => `((${entry.luminance})/100)*${entry.weight}`).join("+")})`;
    const chroma = `min(1,sqrt(pow(${vectorX},2)+pow(${vectorY},2)))`;
    const hue = `if(gt(${chroma},0.0001),atan2(${vectorY},${vectorX})*180/PI,0)`;
    const warmth = `max(0,(${temperature}))/100`;
    const cool = `max(0,-(${temperature}))/100`;
    return {
      sepia: `min(0.34,(${warmth})*0.2+(${chroma})*0.26)`,
      hueRotate: `((${hue})*(${chroma})+(${tint})*0.18+(${cool})*188)`,
      brightness: `max(0.72,1+(${luminance})*0.24+(${wheel.offset.luminance})*0.0014+(${temperature})*0.0003)`,
      contrast: `max(0.78,1+((${wheel.highlights.luminance})-(${wheel.shadows.luminance}))*0.0011)`,
      saturation: `max(0,1+(${authoredSaturation})/100+(${chroma})*0.42)`,
    };
  };
  const pixel = derived(timeExpression);
  const frame = derived("t");

  const r = "r(X,Y)";
  const g = "g(X,Y)";
  const b = "b(X,Y)";
  const brightnessStage = rgbGeq(
    `${r}*(${pixel.brightness})`,
    `${g}*(${pixel.brightness})`,
    `${b}*(${pixel.brightness})`,
  );
  const contrastSaturationStage = `eq=contrast='${frame.contrast}':saturation='${frame.saturation}':eval=frame`;

  const sepiaR = `(0.393*${r}+0.769*${g}+0.189*${b})`;
  const sepiaG = `(0.349*${r}+0.686*${g}+0.168*${b})`;
  const sepiaB = `(0.272*${r}+0.534*${g}+0.131*${b})`;
  const sepiaStage = rgbGeq(
    `${r}*(1-(${pixel.sepia}))+(${pixel.sepia})*${sepiaR}`,
    `${g}*(1-(${pixel.sepia}))+(${pixel.sepia})*${sepiaG}`,
    `${b}*(1-(${pixel.sepia}))+(${pixel.sepia})*${sepiaB}`,
  );
  const hueStage = `hue=h='${frame.hueRotate}':s=1`;

  return `format=gbrp,${brightnessStage},${contrastSaturationStage},${sepiaStage},${hueStage}`;
}

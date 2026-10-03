const DEFAULT_SPATIAL_EFFECT_ID = "original";

export const AUDIO_SPATIAL_EFFECTS = [
  { id: "original", labelKey: "audioSpaceOriginal", duration: 0, decay: 0, wet: 0, dry: 1, preDelay: 0, tone: 18_000, output: 1, reflections: [] },
  { id: "bedroom", labelKey: "audioSpaceBedroom", duration: 0.42, decay: 3.8, wet: 0.3, dry: 0.95, preDelay: 0.006, tone: 7_200, output: 0.98, reflections: [[0.012, 0.34], [0.026, 0.2], [0.051, 0.12]] },
  { id: "living-room", labelKey: "audioSpaceLivingRoom", duration: 0.68, decay: 3.25, wet: 0.38, dry: 0.92, preDelay: 0.009, tone: 8_600, output: 0.96, reflections: [[0.016, 0.38], [0.034, 0.24], [0.072, 0.14]] },
  { id: "bathroom", labelKey: "audioSpaceBathroom", duration: 1.25, decay: 2.55, wet: 0.56, dry: 0.84, preDelay: 0.012, tone: 13_500, output: 0.84, reflections: [[0.018, 0.46], [0.041, 0.31], [0.083, 0.2], [0.132, 0.13]] },
  { id: "hall", labelKey: "audioSpaceHall", duration: 2.35, decay: 2.7, wet: 0.5, dry: 0.86, preDelay: 0.026, tone: 9_800, output: 0.86, reflections: [[0.032, 0.42], [0.071, 0.3], [0.143, 0.2], [0.238, 0.13]] },
  { id: "corridor", labelKey: "audioSpaceCorridor", duration: 1.72, decay: 2.85, wet: 0.5, dry: 0.86, preDelay: 0.02, tone: 8_200, output: 0.87, reflections: [[0.047, 0.48], [0.094, 0.34], [0.188, 0.23], [0.282, 0.15]] },
  { id: "plaza", labelKey: "audioSpacePlaza", duration: 1.38, decay: 3.15, wet: 0.38, dry: 0.92, preDelay: 0.052, tone: 11_500, output: 0.93, reflections: [[0.086, 0.37], [0.171, 0.24], [0.296, 0.14]] },
  { id: "valley", labelKey: "audioSpaceValley", duration: 3.4, decay: 3.35, wet: 0.6, dry: 0.82, preDelay: 0.11, tone: 10_500, output: 0.8, reflections: [[0.22, 0.52], [0.46, 0.36], [0.78, 0.24], [1.14, 0.15]] },
  { id: "studio", labelKey: "audioSpaceStudio", duration: 0.24, decay: 5.2, wet: 0.18, dry: 0.99, preDelay: 0.003, tone: 6_400, output: 1, reflections: [[0.008, 0.18], [0.019, 0.1], [0.036, 0.06]] },
  { id: "office", labelKey: "audioSpaceOffice", duration: 0.58, decay: 3.7, wet: 0.3, dry: 0.95, preDelay: 0.008, tone: 7_600, output: 0.98, reflections: [[0.014, 0.31], [0.032, 0.19], [0.067, 0.11]] },
  { id: "cafe", labelKey: "audioSpaceCafe", duration: 0.86, decay: 3.05, wet: 0.38, dry: 0.92, preDelay: 0.012, tone: 8_900, output: 0.95, reflections: [[0.019, 0.35], [0.046, 0.23], [0.094, 0.15], [0.151, 0.08]] },
  { id: "classroom", labelKey: "audioSpaceClassroom", duration: 1.12, decay: 2.9, wet: 0.43, dry: 0.9, preDelay: 0.016, tone: 9_600, output: 0.92, reflections: [[0.023, 0.39], [0.054, 0.27], [0.108, 0.18], [0.178, 0.1]] },
  { id: "theater", labelKey: "audioSpaceTheater", duration: 2.85, decay: 3.15, wet: 0.54, dry: 0.84, preDelay: 0.038, tone: 8_700, output: 0.84, reflections: [[0.052, 0.41], [0.119, 0.29], [0.238, 0.2], [0.41, 0.12]] },
  { id: "church", labelKey: "audioSpaceChurch", duration: 4.4, decay: 2.75, wet: 0.66, dry: 0.78, preDelay: 0.064, tone: 11_200, output: 0.76, reflections: [[0.074, 0.48], [0.167, 0.35], [0.342, 0.25], [0.61, 0.16], [0.94, 0.1]] },
  { id: "forest", labelKey: "audioSpaceForest", duration: 1.08, decay: 3.9, wet: 0.31, dry: 0.95, preDelay: 0.044, tone: 7_900, output: 0.97, reflections: [[0.071, 0.27], [0.163, 0.18], [0.31, 0.1]] },
  { id: "subway", labelKey: "audioSpaceSubway", duration: 1.62, decay: 2.45, wet: 0.53, dry: 0.86, preDelay: 0.024, tone: 12_800, output: 0.84, reflections: [[0.031, 0.48], [0.066, 0.36], [0.132, 0.25], [0.264, 0.16], [0.396, 0.09]] },
];

const PRESET_BY_ID = new Map(AUDIO_SPATIAL_EFFECTS.map((preset) => [preset.id, preset]));
const impulseCache = new WeakMap();

export function normalizeAudioSpatialEffect(value) {
  return PRESET_BY_ID.has(value) ? value : DEFAULT_SPATIAL_EFFECT_ID;
}

export function normalizeAudioSpatialAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
}

export function getAudioSpatialEffect(value) {
  return PRESET_BY_ID.get(normalizeAudioSpatialEffect(value));
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createImpulseResponse(context, preset) {
  let contextCache = impulseCache.get(context);
  if (!contextCache) {
    contextCache = new Map();
    impulseCache.set(context, contextCache);
  }
  if (contextCache.has(preset.id)) return contextCache.get(preset.id);
  const sampleRate = context.sampleRate || 48_000;
  const length = Math.max(1, Math.ceil(sampleRate * preset.duration));
  const impulse = context.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const values = impulse.getChannelData(channel);
    const random = createRandom(hashSeed(`${preset.id}:${channel}`));
    for (let index = 0; index < length; index += 1) {
      const progress = index / Math.max(1, length - 1);
      const envelope = Math.pow(1 - progress, preset.decay);
      const diffusion = 0.55 + 0.45 * Math.min(1, progress * 12);
      values[index] = (random() * 2 - 1) * envelope * diffusion * 0.0055;
    }
    preset.reflections.forEach(([seconds, gain], reflectionIndex) => {
      const offset = Math.min(length - 1, Math.round(seconds * sampleRate));
      const stereoGain = channel === 0 ? 1 : reflectionIndex % 2 ? 0.82 : 1.08;
      values[offset] += gain * stereoGain;
    });
  }
  contextCache.set(preset.id, impulse);
  return impulse;
}

function setAudioParam(param, value, context, smooth) {
  if (!smooth || typeof param.setTargetAtTime !== "function") {
    param.value = value;
    return;
  }
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, 0.018);
}

export function createAudioSpatialGraph(context, input, destination) {
  const dry = context.createGain();
  const preDelay = context.createDelay(1);
  const convolver = context.createConvolver();
  const tone = context.createBiquadFilter();
  const wet = context.createGain();
  const output = context.createGain();
  tone.type = "lowpass";
  // Browser normalization varies noticeably across engines and can make the
  // wet path nearly inaudible. The generated response is energy-calibrated,
  // so keep its gain explicit and consistent with offline export.
  convolver.normalize = false;
  input.connect(dry).connect(output);
  input.connect(preDelay).connect(convolver).connect(tone).connect(wet).connect(output);
  output.connect(destination);
  return { context, dry, preDelay, convolver, tone, wet, output, effectId: "" };
}

export function applyAudioSpatialEffect(graph, effectId, amount = 1, { smooth = true } = {}) {
  const preset = getAudioSpatialEffect(effectId);
  const mix = normalizeAudioSpatialAmount(amount);
  if (preset.id === graph.effectId && mix === graph.amount) return graph;
  if (preset.id !== graph.effectId) {
    graph.convolver.buffer = preset.id === DEFAULT_SPATIAL_EFFECT_ID ? null : createImpulseResponse(graph.context, preset);
    graph.effectId = preset.id;
  }
  setAudioParam(graph.dry.gain, 1 - mix * (1 - preset.dry), graph.context, smooth);
  setAudioParam(graph.wet.gain, preset.wet * mix, graph.context, smooth);
  setAudioParam(graph.preDelay.delayTime, preset.preDelay, graph.context, smooth);
  setAudioParam(graph.tone.frequency, preset.tone, graph.context, smooth);
  setAudioParam(graph.output.gain, 1 - mix * (1 - preset.output), graph.context, smooth);
  graph.amount = mix;
  return graph;
}

export function connectAudioSpatialEffect(context, input, destination, effectId, amount = 1, options = {}) {
  return applyAudioSpatialEffect(createAudioSpatialGraph(context, input, destination), effectId, amount, options);
}

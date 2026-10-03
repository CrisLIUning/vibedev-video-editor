const descriptors = Object.freeze([
  Object.freeze({
    id: "vibedev.blur",
    version: 1,
    mediaTypes: Object.freeze(["image", "video"]),
    finalRenderer: true,
    parameters: Object.freeze({
      radius: Object.freeze({ type: "number", min: 0.1, max: 20, default: 4 }),
    }),
    ffmpeg(parameters) {
      return `gblur=sigma=${Number(parameters.radius).toFixed(6).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "")}`;
    },
  }),
  Object.freeze({
    id: "vibedev.noir",
    version: 1,
    mediaTypes: Object.freeze(["image", "video"]),
    finalRenderer: true,
    parameters: Object.freeze({}),
    ffmpeg() {
      return "hue=s=0,eq=contrast=1.18";
    },
  }),
  // Kept in the registry so preview code can recognize persisted upstream
  // projects, but deliberately blocked from formal delivery until a paired
  // authoritative renderer exists.
  Object.freeze({
    id: "vibedev.preview-outline",
    version: 1,
    mediaTypes: Object.freeze(["image", "video"]),
    finalRenderer: false,
    parameters: Object.freeze({}),
  }),
]);

const byIdentity = new Map(descriptors.map((descriptor) => [
  `${descriptor.id}@${descriptor.version}`,
  descriptor,
]));

function effectError(code, message) {
  return Object.assign(new Error(message), { code });
}

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeParameters(descriptor, value) {
  const input = value == null ? {} : value;
  if (!plainObject(input)) {
    throw effectError("EFFECT_PARAMETERS_INVALID", `${descriptor.id} parameters must be an object`);
  }
  const unknown = Object.keys(input).filter((key) => !Object.hasOwn(descriptor.parameters, key));
  if (unknown.length) {
    throw effectError("EFFECT_PARAMETERS_INVALID", `${descriptor.id} has unknown parameter: ${unknown[0]}`);
  }
  return Object.fromEntries(Object.entries(descriptor.parameters).map(([name, schema]) => {
    const candidate = Object.hasOwn(input, name) ? input[name] : schema.default;
    if (schema.type === "number") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate)
        || candidate < schema.min || candidate > schema.max) {
        throw effectError(
          "EFFECT_PARAMETERS_INVALID",
          `${descriptor.id}.${name} must be between ${schema.min} and ${schema.max}`,
        );
      }
    }
    return [name, candidate];
  }));
}

export function listRegisteredEffects() {
  return descriptors;
}

export function normalizeRegisteredEffect(value, options = {}) {
  if (!plainObject(value) || typeof value.id !== "string" || !Number.isInteger(value.version)) {
    throw effectError("EFFECT_PARAMETERS_INVALID", "Effect id and integer version are required");
  }
  const descriptor = byIdentity.get(`${value.id}@${value.version}`);
  if (!descriptor) {
    throw effectError("UNSUPPORTED_RENDER_FEATURE", `Unknown effect: ${value.id}@${value.version}`);
  }
  if (options.requireFinalRenderer !== false && descriptor.finalRenderer !== true) {
    throw effectError("UNSUPPORTED_RENDER_FEATURE", `Effect has no authoritative renderer: ${value.id}@${value.version}`);
  }
  if (options.mediaType && !descriptor.mediaTypes.includes(options.mediaType)) {
    throw effectError("UNSUPPORTED_RENDER_FEATURE", `${value.id} does not support ${options.mediaType}`);
  }
  return {
    id: descriptor.id,
    version: descriptor.version,
    parameters: normalizeParameters(descriptor, value.parameters),
  };
}

export function buildRegisteredEffectFfmpegChain(effects, options = {}) {
  return (Array.isArray(effects) ? effects : []).map((effect) => {
    const normalized = normalizeRegisteredEffect(effect, options);
    const descriptor = byIdentity.get(`${normalized.id}@${normalized.version}`);
    return descriptor.ffmpeg(normalized.parameters);
  }).filter(Boolean).join(",");
}

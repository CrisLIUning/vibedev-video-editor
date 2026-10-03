import { orderModelSourceUrls } from "../lib/modelSources.js";

const FACE_SWAP_MODEL_REPOSITORY = "timeline-studio-onnx-models";
const FACE_SWAP_MODEL_DIRECTORY = "mobilefaceswap-224";
const FACE_SWAP_HUGGING_FACE_REVISION = "53cc92dcba612522b1a472189f023870fb36dbcd";
const FACE_SWAP_MODEL_SCOPE_REVISION = "c7e23ba0313f5a96bd1bf2115d98dee1961be5cd";

export const FACE_SWAP_MODELS = Object.freeze({
  identity: Object.freeze({
    id: "mobilefaceswap-224-identity",
    path: "mobilefaceswap_identity.onnx",
    bytes: 209_144_485,
    sha256: "c5816ccc0df3c56d730dc780d134e6fd8a538aa867f85c8be907f3193b8adcde",
    license: "MobileFaceSwap / ArcFace research weights; verify commercial rights before release",
  }),
  conditioner: Object.freeze({
    id: "mobilefaceswap-224-conditioner",
    path: "mobilefaceswap_conditioner.onnx",
    bytes: 82_888_707,
    sha256: "c2696687f44067ed07c886ccc2dcdaccb648f61ae64a965c2d4cc4c846f611cf",
    license: "MobileFaceSwap research weights; verify commercial rights before release",
  }),
  generator: Object.freeze({
    id: "mobilefaceswap-224-generator",
    path: "mobilefaceswap_generator.onnx",
    bytes: 368_108,
    sha256: "94a7f283de05d07795b565e7657d8fa78c823eb0c9762d66e939d4a2314968ea",
    license: "MobileFaceSwap research weights; verify commercial rights before release",
  }),
  scrfd: Object.freeze({
    id: "mobilefaceswap-scrfd-10g-bnkps",
    path: "scrfd_10g_bnkps.onnx",
    bytes: 16_923_827,
    sha256: "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
    license: "MobileFaceSwap official detection checkpoint; verify model-weight rights before release",
  }),
});

function modelBaseUrl() {
  return String(import.meta.env.VITE_MOBILE_FACE_SWAP_MODEL_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function hostedModelUrls(path) {
  return orderModelSourceUrls(
    `https://huggingface.co/haixin/${FACE_SWAP_MODEL_REPOSITORY}/resolve/${FACE_SWAP_HUGGING_FACE_REVISION}/${FACE_SWAP_MODEL_DIRECTORY}/${path}`,
    `https://www.modelscope.cn/models/martindelophy/${FACE_SWAP_MODEL_REPOSITORY}/resolve/${FACE_SWAP_MODEL_SCOPE_REVISION}/${FACE_SWAP_MODEL_DIRECTORY}/${path}`,
  );
}

export function getFaceSwapModelUrls(kind) {
  const model = FACE_SWAP_MODELS[kind];
  if (!model) throw new TypeError(`Unknown MobileFaceSwap model: ${kind}`);
  const exact = String(import.meta.env[`VITE_MOBILE_FACE_SWAP_${kind.toUpperCase()}_URL`] || "").trim();
  if (exact) return [exact];
  const base = modelBaseUrl();
  if (base) return [`${base}/${model.path}`];
  return hostedModelUrls(model.path);
}

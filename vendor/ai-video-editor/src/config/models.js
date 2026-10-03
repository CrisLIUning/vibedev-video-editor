export const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const AUTOMATIC_CAPTION_MODEL_ID = "onnx-community/whisper-small";
export const AUTOMATIC_CAPTION_HOST_MODEL_ID = "whisper-small-q8";
export const AUTOMATIC_CAPTION_MODEL_REVISION = "36050c46d777d46dc4b5f43f6d90574fc38f8732";
export const VIDEO_EDITOR_MODEL_MIRROR_BASE_URL = "https://vibedev.jzsaas.com/video-editor-models";

export const REMASTER_DRUNET_MODEL = {
  id: "seantempesta/remaster-drunet",
  label: "Remaster DRUNet Student",
  revision: "018e7815aa8ef6e3eb6433d2572433d4f36e180e",
  file: "drunet_student.onnx",
};

export const REMASTER_DRUNET_MODEL_URL =
  `${VIDEO_EDITOR_MODEL_MIRROR_BASE_URL}/remaster-drunet/${REMASTER_DRUNET_MODEL.revision}/${REMASTER_DRUNET_MODEL.file}`;
export const AUTOMATIC_CAPTION_MODEL_LABEL = "Whisper small";
export const YOLOS_TINY_MODEL_ID = "yolos-tiny";
export const YOLOS_TINY_MODEL_LABEL = "YOLOS tiny";
export const YOLOS_TINY_MODEL_REVISION = "e2f9c7673f0fa61849efe2b56a0d7774779ebb9d";
export const MODNET_MODEL_ID = "modnet";
export const MODNET_MODEL_LABEL = "MODNet";
export const MODNET_MODEL_REVISION = "fa2fa546052fba4c08921230a26cc69a333fca12";

export function configureVisionModelSource(env) {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = `${VIDEO_EDITOR_MODEL_MIRROR_BASE_URL}/`;
  env.remotePathTemplate = "{model}/{revision}";
}

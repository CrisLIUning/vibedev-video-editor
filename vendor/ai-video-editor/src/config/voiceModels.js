import {
  loadFromMirroredRepository,
  mirroredModelBaseUrls,
  mirroredModelFileUrls,
} from "../lib/modelSources.js";

export const VOICE_MODEL_REPOSITORY = "timeline-studio-voice-models";
export const VOICE_MODEL_HUGGING_FACE_REVISION = "074a57bc4dac9c58568b031898ea79da6f36b282";
export const VOICE_MODEL_MODELSCOPE_REVISION = "9cb5ab964c014b182701153bd00f7a2202f5dce8";
export const OPENVOICE_HUGGING_FACE_REVISION = "d9e0542e0e4e8fcfb849240f7e8e7fa8147df1a3";
export const OPENVOICE_MODELSCOPE_REVISION = "226b24270b69b38781a35566c7d442061f9e3b81";

const mirrorOptions = (path, preference) => ({
  repository: VOICE_MODEL_REPOSITORY,
  huggingFaceRevision: VOICE_MODEL_HUGGING_FACE_REVISION,
  modelScopeRevision: VOICE_MODEL_MODELSCOPE_REVISION,
  path,
  preference,
});

export function voiceModelFileUrls(path, preference) {
  return mirroredModelFileUrls(mirrorOptions(path, preference));
}

export function openVoiceModelFileUrls(path, preference) {
  return mirroredModelFileUrls({
    repository: VOICE_MODEL_REPOSITORY,
    huggingFaceRevision: OPENVOICE_HUGGING_FACE_REVISION,
    modelScopeRevision: OPENVOICE_MODELSCOPE_REVISION,
    path,
    preference,
  });
}

export function voiceModelBaseUrls(path, preference) {
  return mirroredModelBaseUrls(mirrorOptions(path, preference));
}

export function loadVoiceModelFromMirrors(transformersEnv, modelPath, loader, preference) {
  return loadFromMirroredRepository(transformersEnv, {
    ...mirrorOptions("", preference),
    modelPath,
  }, loader);
}

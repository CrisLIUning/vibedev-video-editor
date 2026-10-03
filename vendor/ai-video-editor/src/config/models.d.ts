export const MODEL_ID: string;
export const AUTOMATIC_CAPTION_MODEL_ID: string;
export const AUTOMATIC_CAPTION_HOST_MODEL_ID: string;
export const AUTOMATIC_CAPTION_MODEL_REVISION: string;
export const VIDEO_EDITOR_MODEL_MIRROR_BASE_URL: string;
export const REMASTER_DRUNET_MODEL: {
  id: string;
  label: string;
  revision: string;
  file: string;
};
export const REMASTER_DRUNET_MODEL_URL: string;
export const AUTOMATIC_CAPTION_MODEL_LABEL: string;
export const YOLOS_TINY_MODEL_ID: string;
export const YOLOS_TINY_MODEL_LABEL: string;
export const YOLOS_TINY_MODEL_REVISION: string;
export const MODNET_MODEL_ID: string;
export const MODNET_MODEL_LABEL: string;
export const MODNET_MODEL_REVISION: string;

export function configureVisionModelSource(env: Record<string, unknown>): void;

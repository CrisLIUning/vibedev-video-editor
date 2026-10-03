import { describe, expect, it } from 'vitest';

import {
  MODNET_MODEL_ID,
  REMASTER_DRUNET_MODEL_URL,
  VIDEO_EDITOR_MODEL_MIRROR_BASE_URL,
  YOLOS_TINY_MODEL_ID,
  configureVisionModelSource,
} from '../../../vendor/ai-video-editor/src/config/models.js';
import { VOICES } from '../../../vendor/ai-video-editor/src/config/editor.js';

describe('upstream model mirror', () => {
  it('routes direct editor models through the public VibeDev mirror', () => {
    expect(VIDEO_EDITOR_MODEL_MIRROR_BASE_URL).toBe(
      'https://vibedev.jzsaas.com/video-editor-models',
    );
    expect(REMASTER_DRUNET_MODEL_URL).toBe(
      'https://vibedev.jzsaas.com/video-editor-models/remaster-drunet/018e7815aa8ef6e3eb6433d2572433d4f36e180e/drunet_student.onnx',
    );
    expect(YOLOS_TINY_MODEL_ID).toBe('yolos-tiny');
    expect(MODNET_MODEL_ID).toBe('modnet');
  });

  it('configures Transformers.js for the revision-pinned mirror layout', () => {
    const env: Record<string, unknown> = {};

    configureVisionModelSource(env);

    expect(env).toMatchObject({
      allowLocalModels: false,
      allowRemoteModels: true,
      remoteHost: 'https://vibedev.jzsaas.com/video-editor-models/',
      remotePathTemplate: '{model}/{revision}',
    });
  });

  it('exposes only the published built-in Chinese voices', () => {
    expect(VOICES.map((voice) => ({ id: voice.id, engine: voice.engine, language: voice.language }))).toEqual([
      { id: 'zh_f_qinglan', engine: 'hojo', language: '中文' },
      { id: 'zh_f_ruoxi', engine: 'hojo', language: '中文' },
    ]);
  });
});

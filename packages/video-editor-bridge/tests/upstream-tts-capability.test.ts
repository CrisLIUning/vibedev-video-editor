import { describe, expect, it, vi } from 'vitest';

import { startVoiceGenerationCapability } from '../../../vendor/ai-video-editor/src/lib/voiceGenerationCapability.js';
import { configureKokoroHostModelFiles } from '../../../vendor/ai-video-editor/src/lib/kokoroVoiceRuntime.js';
import { ESPEAK_PIPER_VOICES_ENABLED, KOKORO_VOICES_ENABLED } from '../../../vendor/ai-video-editor/src/config/vibedevFeatures.js';
import { resolvePiperModelRoutes } from '../../../vendor/ai-video-editor/src/lib/piperVoiceRuntime.js';
import hojoWorkerSource from '../../../vendor/ai-video-editor/src/workers/hojoTts.worker.js?raw';
import kokoroRuntimeSource from '../../../vendor/ai-video-editor/src/lib/kokoroVoiceRuntime.js?raw';
import voiceGenerationSource from '../../../vendor/ai-video-editor/src/hooks/useVoiceGeneration.js?raw';
import baseVoiceSource from '../../../vendor/ai-video-editor/src/lib/baseVoiceSynthesis.js?raw';
import editorConfigSource from '../../../vendor/ai-video-editor/src/config/editor.js?raw';
import bridgeBuildConfigSource from '../vite.config.mjs?raw';
import hostBuildScriptSource from '../../../scripts/build-ai-video-editor-host.ts?raw';

describe('upstream TTS capability integration', () => {
  it('does not expose unhosted MMS or Supertonic voices in the current voice picker', () => {
    expect(editorConfigSource).toContain('id: "zh_f_qinglan"');
    expect(editorConfigSource).toContain('id: "zh_f_ruoxi"');
    expect(editorConfigSource).not.toMatch(/id: "(?:ko_KR|vi_VN|ru_RU|th_TH)-mms-medium"/);
    expect(editorConfigSource).not.toContain('id: "ja_JP-supertonic-f1"');
  });

  it('does not ship hidden MMS or Supertonic preview assets in the embedded editor bundle', () => {
    for (const voiceId of [
      'ko_KR-mms-medium',
      'vi_VN-mms-medium',
      'ru_RU-mms-medium',
      'th_TH-mms-medium',
      'ja_JP-supertonic-f1',
    ]) {
      expect(bridgeBuildConfigSource).toContain(`assets/voice-samples/${voiceId}.mp3`);
      expect(bridgeBuildConfigSource).toContain(`assets/voice-avatars/${voiceId}.webp`);
    }
    expect(hostBuildScriptSource).toContain('embedded editor bundle unexpectedly contains excluded voice asset');
    expect(bridgeBuildConfigSource).toContain('assets/effects/models/selfie_segmenter.tflite');
    expect(hostBuildScriptSource).toContain('embedded editor bundle unexpectedly contains model weight');
  });

  it('uses one durable task for multiple generated voice artifacts', async () => {
    const controller = new AbortController();
    const runtime = {
      start: vi.fn(async () => ({ taskId: 'task-tts', signal: controller.signal })),
      progress: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({
        taskId: 'task-tts',
        assets: [
          { assetId: 'asset-1', versionId: 'version-1', url: '/one.wav', kind: 'audio' as const, name: 'one', mimeType: 'audio/wav' },
          { assetId: 'asset-2', versionId: 'version-2', url: '/two.wav', kind: 'audio' as const, name: 'two', mimeType: 'audio/wav' },
        ],
      })),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      prepareModel: vi.fn(async ({ modelId, signal }) => ({
        modelId,
        revision: '074a57bc4dac9c58568b031898ea79da6f36b282',
        artifacts: {
          manifest: '/api/media/video-editor-models/hojo-tts-light-80m-zh/artifacts/manifest',
          'llm-000': '/api/media/video-editor-models/hojo-tts-light-80m-zh/artifacts/llm-000',
        },
        signal,
      })),
    };
    const session = await startVoiceGenerationCapability({
      capabilityRuntime: runtime,
      voiceName: '旁白女声',
      voiceId: 'zh_f_qinglan',
      voiceEngine: 'hojo',
      segmentCount: 2,
    });
    expect(session.signal).toBe(controller.signal);
    expect(session.modelArtifacts).toEqual({
      manifest: '/api/media/video-editor-models/hojo-tts-light-80m-zh/artifacts/manifest',
      'llm-000': '/api/media/video-editor-models/hojo-tts-light-80m-zh/artifacts/llm-000',
    });
    expect(runtime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'hojo-tts-light-80m-zh',
      signal: controller.signal,
    }));
    await session.progress({ progress: 50, phase: 'segment 1' });

    const items = await session.complete([
      { blob: new Blob(['one'], { type: 'audio/wav' }), script: '第一句', placement: { track: 'audio', clipId: 'voice-1', start: 2 } },
      { blob: new Blob(['two'], { type: 'audio/wav' }), script: '第二句', placement: { track: 'audio', clipId: 'voice-2', start: 3 } },
    ]);

    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.complete).toHaveBeenCalledWith(
      'task-tts',
      expect.objectContaining({ capability: 'tts', outputKind: 'audio' }),
      // Named by the line that was spoken, not by a counter — see
      // upstream-voice-clip-naming.test.ts for why.
      { files: [
        expect.objectContaining({ fileName: '第一句-01.wav', title: '第一句 · 旁白女声', placement: { track: 'audio', clipId: 'voice-1', start: 2 } }),
        expect.objectContaining({ fileName: '第二句-02.wav', title: '第二句 · 旁白女声', placement: { track: 'audio', clipId: 'voice-2', start: 3 } }),
      ] },
    );
    expect(items).toEqual([
      expect.objectContaining({ script: '第一句', hostAssetId: 'asset-1', hostVersionId: 'version-1', hostUrl: '/one.wav' }),
      expect.objectContaining({ script: '第二句', hostAssetId: 'asset-2', hostVersionId: 'version-2', hostUrl: '/two.wav' }),
    ]);
  });

  it('keeps hosted Hojo files strict and carries them into every synthesized segment', () => {
    expect(voiceGenerationSource).toContain('modelArtifacts: capabilitySession.modelArtifacts');
    expect(voiceGenerationSource).toContain('getGeneratedVoiceAppendStart');
    expect(voiceGenerationSource).toContain('timelineClipId');
    expect(baseVoiceSource).toContain('modelArtifacts');
    expect(baseVoiceSource).toContain('predictHojoVoice');
    expect(hojoWorkerSource).toContain('Host Hojo model is missing artifact');
    expect(hojoWorkerSource).toContain('Host Hojo model returned HTTP');
    expect(hojoWorkerSource).toContain('reference-codes');
    expect(hojoWorkerSource).toContain('llm-000');
    expect(hojoWorkerSource).toContain('decoder-006');
    expect(hojoWorkerSource).not.toContain('hostModelArtifacts || mirrorBaseUrls');
  });

  it('prepares Kokoro through the host cache and disables remote fallback for hosted artifacts', async () => {
    const controller = new AbortController();
    const runtime = {
      start: vi.fn(async () => ({ taskId: 'task-kokoro', signal: controller.signal })),
      progress: vi.fn(async () => undefined), complete: vi.fn(), fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      prepareModel: vi.fn(async ({ modelId }) => ({
        modelId,
        revision: '074a57bc4dac9c58568b031898ea79da6f36b282',
        artifacts: { 'model-q8': '/api/media/video-editor-models/kokoro-82m-q8-en/artifacts/model-q8' },
      })),
    };

    const start = startVoiceGenerationCapability({
      capabilityRuntime: runtime,
      voiceName: 'Heart',
      voiceId: 'af_heart',
      voiceEngine: 'kokoro',
      segmentCount: 1,
    });

    if (KOKORO_VOICES_ENABLED) {
      const session = await start;
      expect(runtime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
        modelId: 'kokoro-82m-q8-en',
        signal: controller.signal,
      }));
      expect(session.modelArtifacts).toEqual({
        'model-q8': '/api/media/video-editor-models/kokoro-82m-q8-en/artifacts/model-q8',
      });
    } else {
      // VibeDev's builds leave Kokoro out (vibedevFeatures.js): refused before
      // a host task starts or a model downloads, with the editor's message.
      await expect(start).rejects.toMatchObject({ name: 'TtsInputError', code: 'ttsErrorEnglishVoiceUnavailable' });
      expect(runtime.start).not.toHaveBeenCalled();
      expect(runtime.prepareModel).not.toHaveBeenCalled();
    }
    expect(baseVoiceSource).toContain('predictKokoroVoice({ text: prepared.text, voiceId: voice.id, speed, modelArtifacts }');
    expect(kokoroRuntimeSource).toContain('Host Kokoro model is missing artifacts');
    expect(kokoroRuntimeSource).toContain('env.allowRemoteModels = false');
    expect(kokoroRuntimeSource).not.toContain('modelArtifacts || voiceModelFileUrls');
  });

  it('routes every hosted Kokoro model file through the verified daemon artifacts', async () => {
    const artifacts = {
      config: '/models/config', tokenizer: '/models/tokenizer', 'tokenizer-config': '/models/tokenizer-config',
      'model-q8': '/models/model-q8', 'voice-af-heart': '/models/heart', 'voice-am-fenrir': '/models/fenrir',
    };
    const environment: Record<string, any> = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('model', { status: 200 }));
    try {
      expect(configureKokoroHostModelFiles(environment, artifacts)).toBe(true);
      expect(environment).toMatchObject({
        useBrowserCache: false, useCustomCache: true,
        allowLocalModels: true, allowRemoteModels: false,
      });
      await environment.customCache.match('https://host/kokoro/onnx/model_quantized.onnx');
      await environment.customCache.match('https://host/kokoro/tokenizer_config.json?download=1');
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/models/model-q8');
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/models/tokenizer-config');
      expect(() => configureKokoroHostModelFiles({}, { ...artifacts, tokenizer: '' }))
        .toThrow('Host Kokoro model is missing artifacts: tokenizer');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it.each([
    ['de_DE-thorsten-medium', 'piper-de-thorsten-medium'],
    ['es_ES-davefx-medium', 'piper-es-davefx-medium'],
    ['fr_FR-siwis-medium', 'piper-fr-siwis-medium'],
    ['it_IT-riccardo-x_low', 'piper-it-riccardo-x-low'],
    ['pt_BR-faber-medium', 'piper-pt-faber-medium'],
  ])('prepares the selected Piper voice only: %s', async (voiceId, modelId) => {
    const runtime = {
      start: vi.fn(async () => ({ taskId: `task-${voiceId}`, signal: new AbortController().signal })),
      progress: vi.fn(async () => undefined), complete: vi.fn(), fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      prepareModel: vi.fn(async ({ modelId: requestedModelId }) => ({
        modelId: requestedModelId, revision: 'pinned', artifacts: { model: '/model', config: '/config' },
      })),
    };

    const session = await startVoiceGenerationCapability({
      capabilityRuntime: runtime,
      voiceName: voiceId,
      voiceId,
      voiceEngine: 'piper',
      segmentCount: 1,
    });

    if (ESPEAK_PIPER_VOICES_ENABLED) {
      expect(runtime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({ modelId }));
      expect(session.modelArtifacts).toEqual({ model: '/model', config: '/config' });
    } else {
      // Left out of VibeDev's builds (eSpeak NG front end): no host model to download.
      expect(runtime.prepareModel).not.toHaveBeenCalled();
      expect(session.modelArtifacts).toBeUndefined();
    }
  });

  it('routes hosted Piper fetches only to the selected verified daemon bundle', async () => {
    const tts = {
      HF_BASE: 'https://upstream.example',
      PATH_MAP: { 'de_DE-thorsten-medium': 'de/model.onnx' },
    };
    await expect(resolvePiperModelRoutes(tts, {
      voiceId: 'de_DE-thorsten-medium',
      modelArtifacts: { model: '/daemon/model', config: '/daemon/config' },
    })).resolves.toEqual(new Map([
      ['https://upstream.example/de/model.onnx.json', ['/daemon/config']],
      ['https://upstream.example/de/model.onnx', ['/daemon/model']],
    ]));
    await expect(resolvePiperModelRoutes(tts, {
      voiceId: 'de_DE-thorsten-medium',
      modelArtifacts: { model: '/daemon/model' },
    })).rejects.toThrow('Host Piper model is missing artifacts: config');
  });

  it('fails the parent task once when generation throws', async () => {
    const runtime = {
      start: vi.fn(async () => ({ taskId: 'task-tts', signal: new AbortController().signal })),
      progress: vi.fn(async () => undefined), complete: vi.fn(),
      fail: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined),
    };
    const session = await startVoiceGenerationCapability({ capabilityRuntime: runtime, voiceName: 'Voice', segmentCount: 2 });
    await session.fail(new Error('model failed'));
    expect(runtime.fail).toHaveBeenCalledWith('task-tts', {
      code: 'VIDEO_EDITOR_TTS_FAILED', message: 'model failed',
    });
  });
});

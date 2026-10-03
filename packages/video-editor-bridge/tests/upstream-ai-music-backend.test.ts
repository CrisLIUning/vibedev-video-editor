import { describe, expect, it, vi } from 'vitest';

import {
  advanceAiMusicProgress,
  mapAiMusicWorkerProgress,
  resolveAiMusicExecutionProviders,
} from '../../../vendor/ai-video-editor/src/lib/aiMusicBackend.js';
// @ts-expect-error vendored JavaScript is exercised directly before declaration generation
import { resolveHostModelFile } from '../../../vendor/ai-video-editor/src/lib/modelSources.js';
// @ts-expect-error vendored JavaScript is exercised directly before declaration generation
import { translateMusicDescriptionToEnglish } from '../../../vendor/ai-video-editor/src/lib/aiMusicPrompt.js';
// @ts-expect-error vendored JavaScript is exercised directly before declaration generation
import { supportsModelCacheServiceWorker } from '../../../vendor/ai-video-editor/src/lib/serviceWorker.js';
import musicHookSource from '../../../vendor/ai-video-editor/src/hooks/useAiMusicGeneration.js?raw';
import musicWorkerSource from '../../../vendor/ai-video-editor/src/workers/ai-music.worker.js?raw';
import depthWorkerSource from '../../../vendor/ai-video-editor/src/workers/depth-anything.worker.js?raw';

const browserGlobals = globalThis as typeof globalThis & {
  Translator?: unknown;
  LanguageDetector?: unknown;
};

describe('AI music execution backend selection', () => {
  it('falls back instead of hanging when the browser translator never settles', async () => {
    const originalTranslator = browserGlobals.Translator;
    const originalLanguageDetector = browserGlobals.LanguageDetector;
    const destroy = vi.fn();
    Object.assign(globalThis, {
      LanguageDetector: undefined,
      Translator: {
        create: vi.fn(async () => ({
          translate: vi.fn(() => new Promise(() => undefined)),
          destroy,
        })),
      },
    });
    try {
      const translated = translateMusicDescriptionToEnglish('雨夜钢琴', 'zh', {
        timeoutMs: 10,
        fallback: '',
      });
      await expect(Promise.race([
        translated,
        new Promise((_, reject) => setTimeout(() => reject(new Error('translation watchdog expired')), 200)),
      ])).resolves.toBe('');
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(globalThis, {
        Translator: originalTranslator,
        LanguageDetector: originalLanguageDetector,
      });
    }
  });

  it('keeps preset-only generation available when the browser translator is unavailable', async () => {
    const originalTranslator = browserGlobals.Translator;
    Object.assign(globalThis, { Translator: undefined });
    try {
      await expect(translateMusicDescriptionToEnglish('雨夜钢琴', 'zh', {
        timeoutMs: 10,
        fallback: '',
      })).resolves.toBe('');
    } finally {
      Object.assign(globalThis, { Translator: originalTranslator });
    }
  });

  it('stops prompt translation immediately when the host task is canceled', async () => {
    const originalTranslator = browserGlobals.Translator;
    Object.assign(globalThis, {
      Translator: {
        create: vi.fn(async () => ({
          translate: vi.fn(() => new Promise(() => undefined)),
          destroy: vi.fn(),
        })),
      },
    });
    const controller = new AbortController();
    try {
      const translated = translateMusicDescriptionToEnglish('雨夜钢琴', 'zh', {
        signal: controller.signal,
        timeoutMs: 1_000,
        fallback: '',
      });
      controller.abort(new DOMException('Canceled', 'AbortError'));
      await expect(Promise.race([
        translated,
        new Promise((_, reject) => setTimeout(() => reject(new Error('cancel watchdog expired')), 200)),
      ])).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      Object.assign(globalThis, { Translator: originalTranslator });
    }
  });

  it('routes colliding host model names to their exact artifacts', () => {
    const fileKeys = {
      'config.json': 'config',
      'generation_config.json': 'generation-config',
      'preprocessor_config.json': 'preprocessor',
      'tokenizer.json': 'tokenizer',
      'tokenizer_config.json': 'tokenizer-config',
    };

    expect(resolveHostModelFile('https://host/model/preprocessor_config.json', fileKeys))
      .toBe('preprocessor_config.json');
    expect(resolveHostModelFile('https://host/model/generation_config.json?download=1', fileKeys))
      .toBe('generation_config.json');
    expect(resolveHostModelFile({ url: 'https://host/model/tokenizer_config.json' }, fileKeys))
      .toBe('tokenizer_config.json');
  });

  it('keeps hosted worker initialization progress above the completed host preparation stage', () => {
    expect(mapAiMusicWorkerProgress(0, true)).toBeCloseTo(0.58);
    expect(mapAiMusicWorkerProgress(0.32, true)).toBeCloseTo(0.61);
    expect(mapAiMusicWorkerProgress(0.64, true)).toBeCloseTo(0.64);
    expect(mapAiMusicWorkerProgress(0.01, false)).toBeCloseTo(0.01);
    expect(advanceAiMusicProgress(0.58, 0.01, true)).toBeGreaterThanOrEqual(0.58);
    expect(advanceAiMusicProgress(0.7, 0.5, true)).toBeCloseTo(0.7);
  });

  it('uses WASM when WebGPU is absent or cannot provide an adapter', async () => {
    await expect(resolveAiMusicExecutionProviders({})).resolves.toEqual(['wasm']);
    await expect(resolveAiMusicExecutionProviders({
      gpu: { requestAdapter: vi.fn(async () => null) },
    })).resolves.toEqual(['wasm']);
    await expect(resolveAiMusicExecutionProviders({
      gpu: { requestAdapter: vi.fn(async () => { throw new Error('adapter failed'); }) },
    })).resolves.toEqual(['wasm']);
  });

  it('keeps WASM as a session fallback when WebGPU is usable', async () => {
    await expect(resolveAiMusicExecutionProviders({
      gpu: { requestAdapter: vi.fn(async () => ({ name: 'adapter' })) },
    })).resolves.toEqual(['webgpu', 'wasm']);
  });

  it('avoids the unstable WebGPU path for the packaged Windows editor', async () => {
    await expect(resolveAiMusicExecutionProviders({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      gpu: { requestAdapter: vi.fn(async () => ({ name: 'adapter' })) },
    })).resolves.toEqual(['wasm']);
  });

  it('does not attempt service-worker registration on the od desktop protocol', () => {
    expect(supportsModelCacheServiceWorker({ protocol: 'od:' })).toBe(false);
    expect(supportsModelCacheServiceWorker({ protocol: 'https:' })).toBe(true);
  });

  it('uses the VibeDev host model cache when the embedded runtime is available', () => {
    expect(musicHookSource).toContain('modelId: "stable-audio-3-small-music-onnx"');
    expect(musicHookSource).toContain('modelArtifacts');
    expect(musicHookSource).toContain('translationPromise');
    expect(musicHookSource).toContain('timeoutMs: 1_500');
    expect(musicWorkerSource).toContain('data.modelArtifacts');
    expect(musicWorkerSource).toContain('HOST_ARTIFACT_IDS');
    expect(musicWorkerSource).toContain('timeline-studio-model-cache-v5');
  });

  it('keeps hosted model progress monotonic and resets failed depth initialization', () => {
    expect(musicHookSource).toContain('phase.startsWith("cached:")');
    expect(musicHookSource).toContain('phase: "preparing-model"');
    expect(musicHookSource).not.toContain('progress: 1, phase: "translating"');
    expect(musicHookSource).toContain('const descriptionEnglish = await translationPromise');
    expect(musicHookSource).toContain('advanceAiMusicProgress');
    expect(depthWorkerSource).toContain('estimatorPromise = null');
    expect(depthWorkerSource).toContain('resolveHostModelFile(request, HOST_FILE_KEYS)');
  });

  it('reports the actual runtime backend so CPU generation is not mistaken for a hang', () => {
    expect(musicWorkerSource).toContain('backend: runtimeBackend');
    expect(musicHookSource).toContain('backend: data.backend || current.backend');
  });
});

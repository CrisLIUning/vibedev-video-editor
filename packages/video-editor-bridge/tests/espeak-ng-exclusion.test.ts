import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ESPEAK_PIPER_VOICES_ENABLED, KOKORO_VOICES_ENABLED } from '../../../vendor/ai-video-editor/src/config/vibedevFeatures.js';
import { prepareTextForVoice } from '../../../vendor/ai-video-editor/src/lib/ttsText.js';
import { assertNoEspeakNg, espeakNgMarkers, findEspeakNgMarkers } from '../build/espeak-ng-markers';
import kokoroRuntimeSource from '../../../vendor/ai-video-editor/src/lib/kokoroVoiceRuntime.js?raw';
import baseVoiceSource from '../../../vendor/ai-video-editor/src/lib/baseVoiceSynthesis.js?raw';
import editorConfigSource from '../../../vendor/ai-video-editor/src/config/editor.js?raw';
import bridgeBuildConfigSource from '../vite.config.mjs?raw';
import dshBuildScriptSource from '../../../scripts/build-dsh.ts?raw';
import hostBuildScriptSource from '../../../scripts/build-ai-video-editor-host.ts?raw';

// eSpeak NG is GPL-3.0-or-later. kokoro-js (through phonemizer) and vits-web
// (through piper-phonemize) carry it; vibedevFeatures.js turns both off.
const kokoroOff = !KOKORO_VOICES_ENABLED;
const espeakPiperOff = !ESPEAK_PIPER_VOICES_ENABLED;

describe('eSpeak NG front ends stay out of VibeDev builds', () => {
  it('puts each GPL import behind a throw the bundler can see', () => {
    // A throw at the top of the function makes the rest of it unreachable, so
    // Rollup drops the dynamic import and the chunk it would load.
    const kokoroGuard = kokoroRuntimeSource.indexOf('if (!KOKORO_VOICES_ENABLED) throw');
    expect(kokoroGuard).toBeGreaterThan(-1);
    expect(kokoroRuntimeSource.match(/import\("kokoro-js"\)/g)).toHaveLength(1);
    expect(kokoroGuard).toBeLessThan(kokoroRuntimeSource.indexOf('import("kokoro-js")'));
    expect(baseVoiceSource).toMatch(
      /async function loadEspeakPiperRuntime\(\) \{\s*if \(!ESPEAK_PIPER_VOICES_ENABLED\) throw new TtsInputError\("ttsErrorVoiceUnavailable"\);\s*return import\("@diffusionstudio\/vits-web"\);/,
    );
    expect(baseVoiceSource).toContain('const tts = builtInPinyinVoice ? null : await loadEspeakPiperRuntime();');
    expect(baseVoiceSource.match(/import\("@diffusionstudio\/vits-web"\)/g)).toHaveLength(1);
  });

  it('keeps the Chinese voices on front ends without eSpeak NG', () => {
    expect(editorConfigSource).toMatch(/id: "zh_f_qinglan",[\s\S]*?engine: "hojo"/);
    expect(editorConfigSource).toMatch(/id: "zh_f_ruoxi",[\s\S]*?engine: "hojo"/);
    expect(editorConfigSource).not.toMatch(/engine: "kokoro"/);
    // Hojo reads mixed Chinese and English as it did before.
    expect(prepareTextForVoice('今天介绍 VibeDev 剪辑台。', { engine: 'hojo', language: '中文' }).text)
      .toContain('VibeDev');
  });

  it.runIf(kokoroOff)('tells English text that this build has no English AI voice', () => {
    const refusal = (run: () => unknown): unknown => {
      try {
        run();
      } catch (error) {
        return error;
      }
      throw new Error('expected the script to be refused');
    };
    expect(refusal(() => prepareTextForVoice('Hello from the editor.', { engine: 'kokoro', language: 'English' })))
      .toMatchObject({ name: 'TtsInputError', code: 'ttsErrorEnglishVoiceUnavailable' });
    // The Chinese Piper voices used to suggest switching to an English voice.
    expect(refusal(() => prepareTextForVoice('This script is entirely written in English words only.', { engine: 'piper', language: '中文' })))
      .toMatchObject({ name: 'TtsInputError', code: 'ttsErrorEnglishVoiceUnavailable' });
  });

  it.runIf(kokoroOff || espeakPiperOff)('drops the hidden voices\' preview cards from the bundle', () => {
    expect(bridgeBuildConfigSource).toContain('const hiddenVoicePreviewIds');
    expect(bridgeBuildConfigSource).toContain("...(KOKORO_VOICES_ENABLED ? [] : ['af_heart', 'am_fenrir'])");
    expect(bridgeBuildConfigSource).toContain('...hiddenVoicePreviewIds.flatMap(');
  });

  it('scans every editor build for eSpeak NG', () => {
    expect(dshBuildScriptSource).toContain("await assertNoEspeakNg(outputRoot, 'dist-dsh');");
    expect(hostBuildScriptSource).toContain("await assertNoEspeakNg(outputRoot, 'embedded editor bundle');");
  });
});

describe('findEspeakNgMarkers', () => {
  let root = '';
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  async function bundle(files: Record<string, string | Uint8Array>): Promise<string> {
    root = await mkdtemp(path.join(os.tmpdir(), 'espeak-scan-'));
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), content);
    }
    return root;
  }

  const allOff = { kokoroVoices: false, espeakPiperVoices: false };

  it('finds the phonemizer glue, the data package, the loaders and their chunk names', async () => {
    const dir = await bundle({
      'video-editor.js': 'export {};',
      'assets/kokoro-Bz7zST2E.js': 'var e={espeak_EVENT_TYPE:1};',
      'assets/editor-entry-a.js': 'const{KokoroTTS:i}=await import("./x.js");',
      'assets/piper-DeOu3H9E-x.js': 'var t="piper_phonemize.data";f("espeak-ng-data/phontab");',
      'assets/vits-web-C4CBrDN5.js': 'export {};',
      'assets/blob.wasm': new Uint8Array([0, 97, 115, 109, ...Buffer.from('espeak-ng-data')]),
      'assets/espeak-ng-x.data': '',
      'assets/voice-samples/zh_f_qinglan.mp3': 'ID3',
    });
    const findings = await findEspeakNgMarkers(dir, allOff);
    expect(findings).toEqual(expect.arrayContaining([
      { file: 'assets/kokoro-Bz7zST2E.js', marker: 'file name' },
      { file: 'assets/kokoro-Bz7zST2E.js', marker: 'espeak_EVENT_TYPE' },
      { file: 'assets/editor-entry-a.js', marker: 'KokoroTTS' },
      { file: 'assets/piper-DeOu3H9E-x.js', marker: 'piper_phonemize' },
      { file: 'assets/piper-DeOu3H9E-x.js', marker: 'espeak-ng-data' },
      { file: 'assets/vits-web-C4CBrDN5.js', marker: 'file name' },
      { file: 'assets/blob.wasm', marker: 'espeak-ng-data' },
      { file: 'assets/espeak-ng-x.data', marker: 'file name' },
    ]));
    expect(findings.map(finding => finding.file)).not.toContain('video-editor.js');
    expect(findings.map(finding => finding.file)).not.toContain('assets/voice-samples/zh_f_qinglan.mp3');
    await expect(assertNoEspeakNg(dir, 'test bundle', allOff)).rejects.toThrow(/test bundle contains eSpeak NG \(GPL-3.0-or-later\)/);
  });

  it('passes a clean bundle', async () => {
    const dir = await bundle({
      'video-editor.js': 'export {};',
      // Names the editor keeps: a cache name, and transformers.js's WeSpeaker model.
      'assets/hojoTts.worker-a.js': 'const voice="kokoro-voices";const m=["wespeaker-resnet"];',
      'assets/wespeaker-a.js': 'export {};',
    });
    await expect(findEspeakNgMarkers(dir, allOff)).resolves.toEqual([]);
    await expect(assertNoEspeakNg(dir, 'test bundle', allOff)).resolves.toBeUndefined();
  });

  it('stops looking for a front end that was turned on on purpose', () => {
    expect(espeakNgMarkers({ kokoroVoices: true, espeakPiperVoices: true })).toEqual({ content: [], names: [] });
    const piperOnly = espeakNgMarkers({ kokoroVoices: true, espeakPiperVoices: false });
    expect(piperOnly.content).toEqual(['piper_phonemize']);
    const kokoroOnly = espeakNgMarkers({ kokoroVoices: false, espeakPiperVoices: true });
    expect(kokoroOnly.content).toEqual(['espeak_EVENT_TYPE', 'kokoro-js', 'KokoroTTS']);
    expect(espeakNgMarkers(allOff).content).toContain('espeak-ng-data');
  });
});

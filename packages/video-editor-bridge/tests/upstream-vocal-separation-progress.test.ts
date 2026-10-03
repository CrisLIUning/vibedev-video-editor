import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useVocalSeparation.js?raw';

const i18nModule = { exports: {} as { createTranslator: (language: string) => (key: string) => string } };
const i18n = buildSync({ entryPoints: [fileURLToPath(new URL('../../../vendor/ai-video-editor/src/i18n.js', import.meta.url))], bundle: true, format: 'cjs', write: false });
runInNewContext(i18n.outputFiles[0]!.text, { module: i18nModule, exports: i18nModule.exports });

async function run(language: string) {
  const jobs: any[] = [], reports: any[] = [];
  let state: any;
  const module = { exports: {} as any };
  runInNewContext(transformSync(hookSource, { format: 'cjs' }).code, {
    module, exports: module.exports, AbortController,
    require: (name: string) => name === 'react' ? {
      useCallback: (fn: unknown) => fn, useEffect() {}, useRef: (value: unknown) => ({ current: value }),
      useState: (initial: unknown) => { state = initial; return [initial, (next: any) => { state = typeof next === 'function' ? next(state) : next; jobs.push(state); }]; },
    } : name.endsWith('/media.js') ? { decodeWaveform: async () => ({ duration: 1 }) }
      : name.endsWith('/vocalSeparation.js') ? { separateVocals: async (_: unknown, progress: Function) => { progress(34, { key: 'vocalSeparationProcessingChunk', current: 12, total: 41 }); return {}; } }
      : name.endsWith('/audioClipExport.js') ? { renderAudioClipFile: async () => ({ blob: {} }) }
      : { startProcessedMedia: async () => ({ task: { signal: new AbortController().signal }, check() {}, progress: async (update: unknown) => reports.push(update), complete: async () => {}, fail: async (e: Error) => { throw e; } }) },
  });
  const hook = module.exports.useVocalSeparation({ t: i18nModule.exports.createTranslator(language), notify() {}, capabilityRuntime: { prepareModel: async () => ({}) } });
  await hook.separateAudioClipVocals({ name: 'fixture', id: 'clip' });
  return { jobs, reports };
}

describe('vocal separation progress presentation', () => {
  it.each(['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'th', 'vi', 'ru'])('%s preserves numeric chunk counts in the UI and task history', async language => {
    const { jobs, reports } = await run(language);
    const phase = jobs.find(job => job.progress === 34)?.phase;
    expect(phase).toContain('12/41');
    expect(phase).not.toMatch(/[{}]/);
    expect(reports[0]).toEqual({ progress: 34, phase });
    expect(jobs.at(-1)).toMatchObject({ running: false, progress: 100 });
  });
});

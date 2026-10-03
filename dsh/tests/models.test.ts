import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../src/api.ts';
import { HostRequestError, modelFileUrl } from '../src/api.ts';
import type { ModelListing, ModelTask } from '../src/api.ts';
import { consentDialog, createConsentPrompt, formatBytes } from '../src/consent.ts';
import { createModelAccess } from '../src/models.ts';
import type { AskConsent, ModelHost } from '../src/models.ts';

const voice: ModelListing = {
  id: 'hojo-tts-light-80m-zh',
  label: 'Hojo TTS Light 80M Chinese',
  capability: 'tts',
  revision: '9cb5ab9',
  license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', notice: 'Built-in Chinese synthesis bundle.' },
  totalBytes: 291.1 * 1024 * 1024,
  sourceHosts: ['vibedev.jzsaas.com'],
  artifacts: [{ id: 'manifest', fileName: 'manifest.json', bytes: 10 }, { id: 'llm-000', fileName: 'llm.part-000.bin', bytes: 20 }],
};

const fontA: ModelListing = {
  id: 'caption-font-a', label: 'Font A', capability: 'caption-font', revision: 'f00d123', license: { name: 'OFL-1.1' },
  group: 'caption-font', groupSize: 3, totalBytes: 2048, sourceHosts: ['vibedev.jzsaas.com'], artifacts: [{ id: 'font', fileName: 'a.ttf', bytes: 2048 }],
};
const fontB: ModelListing = { ...fontA, id: 'caption-font-b', label: 'Font B' };

/** A stand-in for the plugin's model endpoints. */
function fakeHost(options: { granted?: string[]; tasks?: ModelTask['status'][]; failure?: ModelTask['error'] } = {}) {
  const granted = new Set(options.granted ?? []);
  const calls: string[] = [];
  let polls = 0;
  const host: ModelHost = {
    listModels: vi.fn(async () => ({ models: [voice, fontA, fontB] })),
    getModelConsent: async (modelId) => { calls.push(`consent? ${modelId}`); return { granted: granted.has(modelId) }; },
    setModelConsent: async (modelId, value, group) => {
      calls.push(`consent ${modelId} ${value}${group ? ' group' : ''}`);
      for (const id of group ? [fontA.id, fontB.id] : [modelId]) if (value) granted.add(id);
      return {};
    },
    prepareModel: async (modelId) => {
      calls.push(`prepare ${modelId}`);
      if (!granted.has(modelId)) throw new HostRequestError('需要同意', 409, 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED');
      return { taskId: `task-${modelId}` };
    },
    getModelTask: async (taskId) => {
      const statuses = options.tasks ?? ['running', 'done'];
      const status = statuses[Math.min(polls, statuses.length - 1)]!;
      polls += 1;
      return {
        taskId, modelId: taskId.slice(5), status, progress: status === 'done' ? 100 : 40, phase: status === 'done' ? '已下载' : '正在下载',
        ...(status === 'failed' && options.failure ? { error: options.failure } : {}),
      };
    },
    cancelModelTask: async (taskId) => { calls.push(`cancel ${taskId}`); return {}; },
    modelFileUrl: (modelId, revision, artifactId) => `http://host.test/api/dsh-film/models/${modelId}/${revision}/${artifactId}`,
  };
  return { host, calls, granted };
}

const yes: AskConsent = async () => ({ granted: true, group: false });

describe('getting a model ready', () => {
  it('follows the download and hands the editor each file at its own address', async () => {
    const { host, calls } = fakeHost({ granted: [voice.id] });
    const ask = vi.fn(yes);
    const progress: Array<{ progress: number; phase: string }> = [];
    const prepared = await createModelAccess(host, ask, 1).prepareModel({ modelId: voice.id, onProgress: update => progress.push(update) });
    expect(prepared).toEqual({
      modelId: voice.id,
      revision: '9cb5ab9',
      artifacts: {
        manifest: 'http://host.test/api/dsh-film/models/hojo-tts-light-80m-zh/9cb5ab9/manifest',
        'llm-000': 'http://host.test/api/dsh-film/models/hojo-tts-light-80m-zh/9cb5ab9/llm-000',
      },
    });
    expect(progress).toEqual([{ progress: 40, phase: '正在下载' }, { progress: 100, phase: '已下载' }]);
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toEqual([`prepare ${voice.id}`]);
  });

  it('asks before the first download, and downloads nothing when the person declines', async () => {
    const first = fakeHost();
    const ask = vi.fn(yes);
    await createModelAccess(first.host, ask, 1).prepareModel({ modelId: voice.id });
    expect(ask).toHaveBeenCalledWith(voice);
    expect(first.calls).toEqual([`prepare ${voice.id}`, `consent? ${voice.id}`, `consent ${voice.id} true`, `prepare ${voice.id}`]);

    const declined = fakeHost();
    const access = createModelAccess(declined.host, async () => ({ granted: false, group: true }), 1);
    await expect(access.prepareModel({ modelId: voice.id })).rejects.toMatchObject({ name: 'AbortError', message: `没有下载 ${voice.label}` });
    expect(declined.calls).toEqual([`prepare ${voice.id}`, `consent? ${voice.id}`]);
  });

  it('does not ask again about a declined caption font, but does about a declined voice', async () => {
    const { host } = fakeHost();
    const ask = vi.fn(async () => ({ granted: false, group: false }));
    const access = createModelAccess(host, ask, 1);
    for (let attempt = 0; attempt < 3; attempt++) await expect(access.prepareModel({ modelId: fontA.id })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ask).toHaveBeenCalledTimes(1);
    for (let attempt = 0; attempt < 2; attempt++) await expect(access.prepareModel({ modelId: voice.id })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('asks once for a group the person agreed to as a whole, one question at a time', async () => {
    const { host, calls } = fakeHost();
    let open = 0;
    const ask = vi.fn(async () => {
      open += 1;
      expect(open).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 5));
      open -= 1;
      return { granted: true, group: true };
    });
    const access = createModelAccess(host, ask, 1);
    await Promise.all([access.prepareModel({ modelId: fontA.id }), access.prepareModel({ modelId: fontB.id })]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(calls).toContain(`consent ${fontA.id} true group`);
    expect(calls.filter(call => call.startsWith('consent ') && !call.startsWith('consent?'))).toHaveLength(1);
  });

  it('reports a failed download with its code, and cancels the download when the editor gives up', async () => {
    const failing = fakeHost({ granted: [voice.id], tasks: ['running', 'failed'], failure: { code: 'VIDEO_EDITOR_MODEL_INTEGRITY_FAILED', message: '校验不通过' } });
    await expect(createModelAccess(failing.host, yes, 1).prepareModel({ modelId: voice.id })).rejects.toMatchObject({ message: '校验不通过', code: 'VIDEO_EDITOR_MODEL_INTEGRITY_FAILED' });

    const slow = fakeHost({ granted: [voice.id], tasks: ['running'] });
    const controller = new AbortController();
    const pending = createModelAccess(slow.host, yes, 5).prepareModel({ modelId: voice.id, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 12));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(slow.calls).toContain(`cancel task-${voice.id}`);
  });

  it('refuses a model the plugin does not offer, and reads the list once', async () => {
    const { host } = fakeHost();
    const access = createModelAccess(host, yes, 1);
    await expect(access.prepareModel({ modelId: 'mobilefaceswap-224' })).rejects.toThrow('不提供这个模型（mobilefaceswap-224）');
    await access.ensureModelConsent(voice.id);
    expect(host.listModels).toHaveBeenCalledTimes(1);
  });

  it('checks consent on its own for the host\'s captions', async () => {
    const { host, calls } = fakeHost({ granted: [voice.id] });
    const ask = vi.fn(yes);
    await createModelAccess(host, ask, 1).ensureModelConsent(voice.id);
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toEqual([`consent? ${voice.id}`]);
  });

  it('serves model files from the plugin\'s own routes', () => {
    expect(modelFileUrl('whisper-small-q8', '36050c4', 'encoder-q8')).toBe('http://host.test/api/dsh-film/models/whisper-small-q8/36050c4/encoder-q8');
  });
});

describe('the plugin\'s answers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const answering = (status: number, body: unknown) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('reads a 409 that is not about the cut as the refusal it is', async () => {
    const fetch = answering(409, { error: '下载 Font A 之前需要你的同意。', code: 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED' });
    await expect(api.prepareModel('caption-font-a')).rejects.toMatchObject({ name: 'HostRequestError', status: 409, code: 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED', message: '下载 Font A 之前需要你的同意。' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/dsh-film/studio-write?cwd=C%3A%5Cws&path=%2Fapi%2Fmedia%2Fvideo-editor-models%2Fcaption-font-a%2Fprepare&method=POST');
    expect(init.method).toBe('POST');
  });

  it('still reads a timeline 409 as a conflict, readable or not', async () => {
    answering(409, { error: 'stale', code: 'CANVAS_TIMELINE_CONFLICT', current: { document: {}, revision: 4, canUndo: false, canRedo: false, historyLength: 0 } });
    await expect(api.saveTimeline({}, 3)).rejects.toBeInstanceOf(api.TimelineConflictError);
    answering(409, { error: 'stale', code: 'CANVAS_TIMELINE_CONFLICT' });
    await expect(api.saveTimeline({}, 3)).rejects.toMatchObject({ code: 'CANVAS_TIMELINE_CONFLICT_UNREADABLE' });
    answering(409, 'not json');
    await expect(api.saveTimeline({}, 3)).rejects.toMatchObject({ code: 'CANVAS_TIMELINE_CONFLICT_UNREADABLE' });
  });
});

describe('the question', () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('says what the model is for, its size, licence and source', () => {
    const { root, group } = consentDialog(document, voice);
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.textContent).toContain('剪辑台要先下载「Hojo TTS Light 80M Chinese」，才能生成配音。');
    expect(root.textContent).toContain('291.1 MB，只下载一次');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://www.apache.org/licenses/LICENSE-2.0');
    expect(root.textContent).toContain('Built-in Chinese synthesis bundle.');
    expect(root.textContent).toContain('vibedev.jzsaas.com');
    expect(group).toBeNull();
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
  });

  it('answers yes with the group, and no on Esc', async () => {
    const ask = createConsentPrompt(document);
    const answer = ask(fontA);
    const dialog = document.querySelector('.consent')!;
    expect(dialog.textContent).toContain('其余 2 款字幕字体（同为 OFL-1.1）以后直接下载');
    expect(document.activeElement?.textContent).toBe('下载');
    (dialog.querySelector('[data-action="confirm"]') as HTMLButtonElement).click();
    expect(await answer).toEqual({ granted: true, group: true });
    expect(document.querySelector('.consent')).toBeNull();

    const second = ask(fontB);
    (document.querySelector('.consent input') as HTMLInputElement).checked = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await second).toEqual({ granted: false, group: false });
    expect(document.querySelector('.consent')).toBeNull();
  });
});

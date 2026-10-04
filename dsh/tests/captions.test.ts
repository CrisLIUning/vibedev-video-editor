import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HostRequestError, TimelineConflictError } from '../src/api.ts';
import type { CaptionDraft, CaptionEngines, CaptionTaskSummary, TimelineState } from '../src/api.ts';
import {
  GATEWAY_NOTICE,
  createCaptionFlow,
  createEnginePrompt,
  engineDialog,
  estimateText,
  openCaptionReview,
} from '../src/captions.ts';
import type { CaptionFlowOptions, CaptionHost, ChooseEngine, EngineOffer } from '../src/captions.ts';

const CATALOGUE_BASIS = 'catalogue price per second × source seconds; an upper bound, only speech is sent';
const quoted = { seconds: 150, amountCny: 0.13, basis: CATALOGUE_BASIS };

const engines = (overrides: Partial<{ whisper: Record<string, unknown>; gateway: Record<string, unknown> }> = {}): CaptionEngines => ({
  default: 'whisper',
  engines: [
    { id: 'whisper', available: true, consent: { 'whisper-small-q8': false, 'silero-vad': true }, downloadBytes: 254_174_137, runner: 'connected', ...overrides.whisper } as CaptionEngines['engines'][number],
    { id: 'gateway', available: true, languages: ['zh'], model: 'doubao-asr-vibedev', limits: { maxSeconds: 600, maxBytes: 20_000_000 }, ...overrides.gateway } as CaptionEngines['engines'][number],
  ],
});

const draft: CaptionDraft = {
  kind: 'timeline-caption-draft',
  schemaVersion: 1,
  baseRevision: 4,
  model: 'whisper-small-q8',
  engine: 'whisper',
  reviewStatus: 'unreviewed',
  ranges: [{ start: 0, end: 10 }],
  sources: [
    { clipId: 'a', file: 'canvas/media/a.wav', start: 0, end: 5, sourceIn: 0, sourceOut: 5 },
    { clipId: 'b', file: 'canvas/media/b.wav', start: 5, end: 10, sourceIn: 0, sourceOut: 5 },
  ],
  segments: [
    { id: 'one', text: '第一句', start: 1, end: 2, sourceClipId: 'a', sourceIn: 3, sourceOut: 4 },
    { id: 'two', text: '第二句', start: 4, end: 5, sourceClipId: 'b', sourceIn: 7, sourceOut: 8, warnings: ['weak-speech-evidence'] },
    { id: 'three', text: '第三句', start: 6, end: 7, sourceClipId: 'a', sourceIn: 9, sourceOut: 10, warnings: ['region-timing'] },
  ],
};

const task = (overrides: Partial<CaptionTaskSummary> = {}): CaptionTaskSummary => ({
  taskId: 'asr-1', status: 'done', engine: 'whisper', model: 'whisper-small-q8', startedAt: Date.UTC(2026, 9, 4, 4), endedAt: null, applied: false, segments: 3, ranges: [{ start: 0, end: 10 }], ...overrides,
});

const state = (revision: number): TimelineState => ({ document: { revision }, revision, canUndo: false, canRedo: false, historyLength: revision });

function fakeHost(overrides: Partial<CaptionHost> = {}) {
  const calls: string[] = [];
  let tasks: CaptionTaskSummary[] = [];
  const host: CaptionHost = {
    getCaptionEngines: vi.fn(async () => engines()),
    startTranscription: vi.fn(async (body) => { calls.push(`start ${body.baseRevision}`); return { taskId: 'asr-1', status: 'running', engine: body.engine ?? 'whisper' }; }),
    estimateTranscription: vi.fn(async (body) => { calls.push(`estimate ${body.baseRevision}`); return { estimate: quoted, engine: 'gateway' as const }; }),
    listCaptionTasks: vi.fn(async () => ({ tasks })),
    waitTask: vi.fn(async (taskId: string) => ({ taskId, status: 'done' as const, startedAt: 0, endedAt: 1, progress: [], nextSince: 0, file: { documentResult: draft } })),
    cancelTask: vi.fn(async (taskId: string) => { calls.push(`cancel ${taskId}`); return { ok: true }; }),
    applyCaptions: vi.fn(async (body) => { calls.push(`apply ${body.dryRun ? 'dry' : 'commit'}`); return { committed: !body.dryRun, revision: 5, duplicate: false, appliedOperationIds: [], warnings: [] }; }),
    projectRawUrl: path => `/api/projects/film-1/raw/${path}`,
    ...overrides,
  };
  return { host, calls, setTasks: (next: CaptionTaskSummary[]) => { tasks = next; } };
}

const flows: Array<{ dispose(): void }> = [];

function flow(host: CaptionHost, calls: string[], overrides: Partial<CaptionFlowOptions> = {}) {
  const memory = new Map<string, string>();
  const options: CaptionFlowOptions = {
    host,
    ensureModelConsent: vi.fn(async (modelId: string) => { calls.push(`consent ${modelId}`); }),
    prepareTimeline: vi.fn(async () => { calls.push('save'); return 4; }),
    adoptTimeline: vi.fn(),
    reloadTimeline: vi.fn(async () => { calls.push('reload'); }),
    notify: vi.fn(),
    chooseEngine: vi.fn<ChooseEngine>(async offer => offer.preferred),
    doc: document,
    storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } },
    activePollMs: 5,
    idlePollMs: 60_000,
    ...overrides,
  };
  const created = createCaptionFlow(options);
  flows.push(created);
  return { ...created, options, memory };
}

afterEach(() => {
  for (const created of flows.splice(0)) created.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('submitting a recognition', () => {
  it('asks consent for the models not yet agreed to, saves, then submits a background task and leaves the cut alone', async () => {
    const { host, calls } = fakeHost();
    const { transcribeTimeline, options } = flow(host, calls);
    const result = await transcribeTimeline({ clipId: 'clip', track: 'audio', start: 2, duration: 3, language: 'zh', onProgress: () => {} });
    expect(result).toEqual({ segments: [], text: '', backgroundTaskId: 'asr-1' });
    expect(calls).toEqual(['consent whisper-small-q8', 'save', 'start 4']);
    expect(host.startTranscription).toHaveBeenCalledWith({
      engine: 'whisper', language: 'zh', clipIds: ['clip'], range: { start: 2, end: 5 }, baseRevision: 4, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(options.chooseEngine).toHaveBeenCalledWith({ engines: engines(), preferred: 'whisper', estimateGateway: expect.any(Function) });
    expect(host.estimateTranscription).not.toHaveBeenCalled();
    expect(host.applyCaptions).not.toHaveBeenCalled();
  });

  it('shows the plugin\'s estimate for the same request, then sends the gateway Mandarin with the spending confirmed, and remembers the choice', async () => {
    const { host, calls } = fakeHost();
    vi.mocked(host.startTranscription).mockImplementation(async (body) => {
      calls.push(`start ${body.baseRevision}`);
      return { taskId: 'asr-2', status: 'running', engine: 'gateway' as const, estimate: { seconds: 120, amountCny: 0.1, basis: CATALOGUE_BASIS } };
    });
    const shown: unknown[] = [];
    // As the dialog does: the estimate is shown before paying is offered.
    const chooseEngine = vi.fn<ChooseEngine>(async (offer) => { shown.push(await offer.estimateGateway()); return 'gateway'; });
    const { transcribeTimeline, options, memory } = flow(host, calls, { chooseEngine });
    await transcribeTimeline({ clipId: 'clip', start: 2, duration: 3, language: 'en', onProgress: () => {} });
    expect(shown).toEqual([quoted]);
    const asked = { engine: 'gateway', language: 'zh', clipIds: ['clip'], range: { start: 2, end: 5 }, baseRevision: 4, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) };
    expect(host.estimateTranscription).toHaveBeenCalledWith(asked);
    expect(host.startTranscription).toHaveBeenCalledWith({ ...asked, spendingConfirmed: true });
    expect(calls).toEqual(['save', 'estimate 4', 'save', 'start 4']);
    expect(options.ensureModelConsent).not.toHaveBeenCalled();
    expect(options.notify).toHaveBeenCalledWith('已提交网关转写，预计 ¥0.10', 'info');
    expect(memory.get('dsh-film:caption-engine')).toBe('gateway');

    // Next time the remembered engine is the one preselected.
    await transcribeTimeline({ language: 'zh', onProgress: () => {} });
    expect(chooseEngine.mock.calls[1]![0].preferred).toBe('gateway');
  });

  it('submits nothing to the gateway when the estimate is refused, and says why', async () => {
    const { host, calls } = fakeHost({
      estimateTranscription: vi.fn(async () => { throw new HostRequestError('CAPTION_ENGINE_UNAVAILABLE: not signed in', 503, 'CAPTION_ENGINE_UNAVAILABLE', { cause: 'NOT_SIGNED_IN' }); }),
    });
    const { transcribeTimeline } = flow(host, calls, { chooseEngine: async () => 'gateway' });
    await expect(transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('请先登录 VibeDev 账号');
    expect(host.estimateTranscription).toHaveBeenCalledTimes(1);
    expect(host.startTranscription).not.toHaveBeenCalled();

    // A plugin that does not know estimates started a recognition: it is stopped, and nothing is confirmed.
    const old = fakeHost({ estimateTranscription: vi.fn(async () => ({ taskId: 'asr-9', status: 'running' }) as never) });
    await expect(flow(old.host, old.calls, { chooseEngine: async () => 'gateway' }).transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('没有给出网关费用估算');
    expect(old.host.cancelTask).toHaveBeenCalledWith('asr-9');
    expect(old.host.startTranscription).not.toHaveBeenCalled();

    // A cut that moved on before the estimate: shown, and nothing is sent.
    const moved = fakeHost({ estimateTranscription: vi.fn(async () => { throw new TimelineConflictError(state(9)); }) });
    const stale = flow(moved.host, moved.calls, { chooseEngine: async () => 'gateway' });
    await expect(stale.transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('剪辑刚被别处改过');
    expect(stale.options.adoptTimeline).toHaveBeenCalledWith(state(9));
    expect(moved.host.startTranscription).not.toHaveBeenCalled();
  });

  it('estimates again for a cut that moved on, and never sends the gateway more than was confirmed', async () => {
    const answers = [quoted, { ...quoted, seconds: 140, amountCny: 0.12 }];
    const conflictOnce = () => {
      let attempt = 0;
      return vi.fn(async (body: { baseRevision: number }) => {
        attempt += 1;
        if (attempt === 1) throw new TimelineConflictError(state(7));
        return { taskId: `asr-${body.baseRevision}`, status: 'running' };
      });
    };
    const cheaper = fakeHost({ startTranscription: conflictOnce(), estimateTranscription: vi.fn(async () => ({ estimate: answers.shift()! })) });
    let revision = 4;
    const moved = flow(cheaper.host, cheaper.calls, { chooseEngine: async () => 'gateway', prepareTimeline: async () => revision });
    vi.mocked(moved.options.adoptTimeline).mockImplementation((current) => { revision = current.revision; });
    await expect(moved.transcribeTimeline({ language: 'zh', onProgress: () => {} })).resolves.toMatchObject({ backgroundTaskId: 'asr-7' });
    expect(vi.mocked(cheaper.host.estimateTranscription).mock.calls.map(([body]) => body.baseRevision)).toEqual([4, 7]);

    const dearer = fakeHost({ startTranscription: conflictOnce(), estimateTranscription: vi.fn(async (body) => ({ estimate: body.baseRevision === 4 ? quoted : { ...quoted, seconds: 300, amountCny: 0.25 } })) });
    revision = 4;
    const grown = flow(dearer.host, dearer.calls, { chooseEngine: async () => 'gateway', prepareTimeline: async () => revision });
    vi.mocked(grown.options.adoptTimeline).mockImplementation((current) => { revision = current.revision; });
    await expect(grown.transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('网关费用比你确认的高');
    expect(dearer.host.startTranscription).toHaveBeenCalledTimes(1);
  });

  it('asks the Silero consent the gateway needs before anything is sent', async () => {
    const { host, calls } = fakeHost({
      getCaptionEngines: vi.fn(async () => engines({ whisper: { consent: { 'whisper-small-q8': false, 'silero-vad': false } }, gateway: { consent: { 'silero-vad': false } } })),
    });
    const { transcribeTimeline } = flow(host, calls, { chooseEngine: async () => 'gateway' });
    await transcribeTimeline({ language: 'zh', onProgress: () => {} });
    expect(calls).toEqual(['save', 'estimate 4', 'consent silero-vad', 'save', 'start 4']);
  });

  it('retries once for a cut that moved on and once for a consent refusal, independently', async () => {
    let attempt = 0;
    const { host, calls } = fakeHost({
      startTranscription: vi.fn(async (body) => {
        calls.push(`start ${body.baseRevision}`);
        attempt += 1;
        if (attempt === 1) throw new TimelineConflictError(state(7));
        if (attempt === 2) throw new HostRequestError('consent', 409, 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED', { modelIds: ['silero-vad'] });
        if (attempt === 3) throw new TimelineConflictError(state(8));
        return { taskId: 'asr-5', status: 'running' };
      }),
    });
    let revision = 4;
    const { transcribeTimeline, options } = flow(host, calls, { prepareTimeline: async () => revision });
    vi.mocked(options.adoptTimeline).mockImplementation((current) => { revision = current.revision; });
    // A second conflict is not retried again.
    await expect(transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('剪辑刚被别处改过');
    expect(calls.filter(call => call.startsWith('start') || call === 'consent silero-vad')).toEqual(['start 4', 'start 7', 'consent silero-vad', 'start 7']);
  });

  it('submits nothing when the person cancels the choice or declines a model', async () => {
    const { host, calls } = fakeHost();
    const cancelled = flow(host, calls, { chooseEngine: async () => null });
    await expect(cancelled.transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toMatchObject({ name: 'AbortError' });
    const declined = flow(host, calls, { ensureModelConsent: async () => { throw new DOMException('没有下载 Whisper', 'AbortError'); } });
    await expect(declined.transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.startTranscription).not.toHaveBeenCalled();
  });

  it('refuses music, and a second submission while one is being made', async () => {
    let release!: (engine: 'whisper') => void;
    const { host, calls } = fakeHost();
    const { transcribeTimeline } = flow(host, calls, { chooseEngine: () => new Promise(resolve => { release = resolve; }) });
    await expect(transcribeTimeline({ track: 'music', language: 'zh', onProgress: () => {} })).rejects.toThrow('不能把音乐当作对白');
    const first = transcribeTimeline({ language: 'zh', onProgress: () => {} });
    await expect(transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('字幕识别正在进行');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release('whisper');
    await expect(first).resolves.toMatchObject({ backgroundTaskId: 'asr-1' });
  });

  it('shows a cut that moved on and submits again on its revision', async () => {
    let attempt = 0;
    const { host, calls } = fakeHost({
      startTranscription: vi.fn(async (body) => {
        calls.push(`start ${body.baseRevision}`);
        attempt += 1;
        if (attempt === 1) throw new TimelineConflictError(state(7));
        return { taskId: 'asr-3', status: 'running' };
      }),
    });
    let revision = 4;
    const { transcribeTimeline, options } = flow(host, calls, { prepareTimeline: async () => revision });
    vi.mocked(options.adoptTimeline).mockImplementation((current) => { revision = current.revision; });
    await expect(transcribeTimeline({ language: 'zh', onProgress: () => {} })).resolves.toMatchObject({ backgroundTaskId: 'asr-3' });
    expect(options.adoptTimeline).toHaveBeenCalledWith(state(7));
    expect(calls.filter(call => call.startsWith('start'))).toEqual(['start 4', 'start 7']);
  });

  it('asks about the models a consent refusal names, then submits again', async () => {
    let attempt = 0;
    const { host, calls } = fakeHost({
      startTranscription: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new HostRequestError('consent', 409, 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED', { modelIds: ['silero-vad'] });
        return { taskId: 'asr-4', status: 'running' };
      }),
    });
    const { transcribeTimeline } = flow(host, calls);
    await transcribeTimeline({ language: 'zh', onProgress: () => {} });
    expect(calls.filter(call => call.startsWith('consent'))).toEqual(['consent whisper-small-q8', 'consent silero-vad']);
    expect(host.startTranscription).toHaveBeenCalledTimes(2);
  });

  it('says a refusal in Chinese and keeps its code', async () => {
    const { host, calls } = fakeHost({ startTranscription: vi.fn(async () => { throw new HostRequestError('CAPTION_RUNTIME_UNAVAILABLE: no runner', 503, 'CAPTION_RUNTIME_UNAVAILABLE'); }) });
    const { transcribeTimeline } = flow(host, calls);
    await expect(transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toMatchObject({
      message: expect.stringContaining('本机识别需要一个打开着的 VibeDev 窗口'),
      code: 'CAPTION_RUNTIME_UNAVAILABLE',
    });
    const gateway = fakeHost({ startTranscription: vi.fn(async () => { throw new HostRequestError('CAPTION_ENGINE_UNAVAILABLE: not signed in', 503, 'CAPTION_ENGINE_UNAVAILABLE', { cause: 'NOT_SIGNED_IN' }); }) });
    await expect(flow(gateway.host, gateway.calls, { chooseEngine: async () => 'gateway' }).transcribeTimeline({ language: 'zh', onProgress: () => {} })).rejects.toThrow('请先登录 VibeDev 账号');
  });
});

describe('the background panel', () => {
  it('lists unapplied recognitions, follows a running one closely, and cancels on request', async () => {
    const { host, calls, setTasks } = fakeHost();
    setTasks([task({ status: 'running', progress: ['20% · 正在识别'] }), task({ taskId: 'asr-0', applied: true })]);
    const { panel } = flow(host, calls);
    await vi.waitFor(() => expect(panel.hidden).toBe(false));
    expect(panel.textContent).toContain('后台字幕识别');
    expect(panel.textContent).toContain('20% · 正在识别');
    expect(panel.querySelectorAll('.caption-task')).toHaveLength(1);
    (panel.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls).toContain('cancel asr-1'));
    // Running: asked again soon, not in fifteen seconds.
    await vi.waitFor(() => expect(vi.mocked(host.listCaptionTasks).mock.calls.length).toBeGreaterThan(2));
  });

  it('reads progress and errors from the task when the summary leaves them out', async () => {
    const { host, calls, setTasks } = fakeHost({
      waitTask: vi.fn(async (taskId: string) => ({
        taskId, status: 'failed' as const, startedAt: 0, endedAt: 1, progress: ['5% · 准备模型'], nextSince: 1, error: { code: 'CAPTION_RUNTIME_LOST', message: 'runner gone' },
      })),
    });
    setTasks([task({ status: 'failed', segments: 0 })]);
    const { panel } = flow(host, calls);
    await vi.waitFor(() => expect(panel.textContent).toContain('运行识别的窗口关掉了'));
    expect(host.waitTask).toHaveBeenCalledWith('asr-1', 0, 0, expect.any(AbortSignal));
  });

  it('stays hidden with nothing to show, and tells the person once when a recognition finishes', async () => {
    const { host, calls, setTasks } = fakeHost();
    const { panel, refresh, options } = flow(host, calls);
    await vi.waitFor(() => expect(host.listCaptionTasks).toHaveBeenCalled());
    expect(panel.hidden).toBe(true);
    setTasks([task({ status: 'running', progress: [] })]);
    refresh();
    await vi.waitFor(() => expect(panel.hidden).toBe(false));
    setTasks([task()]);
    await vi.waitFor(() => expect(panel.textContent).toContain('识别完成，3 句待校对'));
    expect(options.notify).toHaveBeenCalledWith('原声字幕草稿识别好了，可以在右下角打开校对', 'success');
    refresh();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(vi.mocked(options.notify).mock.calls.filter(([text]) => String(text).startsWith('原声字幕草稿识别好了'))).toHaveLength(1);
  });

  it('keeps asking after a failed read, at the idle pace', async () => {
    const { host, calls, setTasks } = fakeHost();
    setTasks([task({ status: 'running', progress: ['20% · 正在识别'] })]);
    vi.mocked(host.listCaptionTasks).mockRejectedValueOnce(new HostRequestError('读取字幕识别任务 (502)', 502));
    const { panel } = flow(host, calls, { idlePollMs: 200 });
    await vi.waitFor(() => expect(panel.textContent).toContain('读取字幕识别任务 (502)'));
    await vi.waitFor(() => expect(panel.textContent).toContain('20% · 正在识别'));
    expect(panel.querySelector('.caption-alert')).toBeNull();
  });
});

describe('reviewing and applying a draft', () => {
  const openFromPanel = async (panel: HTMLElement) => {
    await vi.waitFor(() => expect(panel.querySelector('[data-action="open"]')).not.toBeNull());
    (panel.querySelector('[data-action="open"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.caption-review')).not.toBeNull());
    return document.querySelector('.caption-review') as HTMLElement;
  };
  const button = (root: HTMLElement, action: string) => root.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;

  it('opens a finished draft only on demand, and closes it without cancelling anything', async () => {
    const { host, calls, setTasks } = fakeHost();
    setTasks([task()]);
    const { panel } = flow(host, calls);
    const review = await openFromPanel(panel);
    expect(review.textContent).toContain('原声字幕草稿');
    expect(review.textContent).toContain('第二句（人声证据较弱，请试听）');
    expect(review.textContent).toContain('第三句（按人声段计时，请试听）');
    expect(host.waitTask).toHaveBeenCalledWith('asr-1', 0, 1000);
    button(review, 'later').click();
    expect(document.querySelector('.caption-review')).toBeNull();
    expect(host.cancelTask).not.toHaveBeenCalled();
    expect(host.applyCaptions).not.toHaveBeenCalled();
  });

  it('applies through the save barrier: a dry run, the commit, then the cut is re-read', async () => {
    const { host, calls, setTasks } = fakeHost();
    setTasks([task()]);
    const { panel, options } = flow(host, calls);
    const review = await openFromPanel(panel);
    expect(button(review, 'apply').disabled).toBe(true);
    const checkbox = review.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(button(review, 'apply').disabled).toBe(false);
    button(review, 'apply').click();
    await vi.waitFor(() => expect(calls).toContain('reload'));
    expect(calls.slice(calls.indexOf('save'))).toEqual(['save', 'apply dry', 'apply commit', 'reload']);
    expect(host.applyCaptions).toHaveBeenNthCalledWith(1, { taskId: 'asr-1', reviewed: true, excludeSegmentIds: [], dryRun: true });
    expect(document.querySelector('.caption-review')).toBeNull();
    expect(options.notify).toHaveBeenCalledWith('字幕已写入时间线', 'success');
  });

  it('says a stale draft cannot be written inside the review, and never commits after a failed dry run', async () => {
    const { host, calls, setTasks } = fakeHost({
      applyCaptions: vi.fn(async () => { throw new HostRequestError('timeline moved', 409, 'CANVAS_TIMELINE_CONFLICT_UNREADABLE'); }),
    });
    setTasks([task()]);
    const { panel, options } = flow(host, calls);
    const review = await openFromPanel(panel);
    const checkbox = review.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    button(review, 'apply').click();
    await vi.waitFor(() => expect(review.querySelector('.caption-alert[role="alert"]:not([hidden])')?.textContent).toContain('不能直接写入'));
    expect(host.applyCaptions).toHaveBeenCalledTimes(1);
    expect(options.reloadTimeline).not.toHaveBeenCalled();
  });

  it('leaves out and restores the selected line; applying needs the check again and at least one line', async () => {
    const onApply = vi.fn();
    const review = openCaptionReview({ doc: document, draft, projectRawUrl: path => `/raw/${path}`, onApply, onClose: () => {} });
    const toggle = review.root.querySelector('.caption-toggle') as HTMLButtonElement;
    const checkbox = review.root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const apply = review.root.querySelector('[data-action="apply"]') as HTMLButtonElement;
    expect(toggle.textContent).toBe('排除选中句');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    toggle.click();
    expect(toggle.textContent).toBe('保留选中句');
    expect(checkbox.checked).toBe(false);
    expect(review.root.textContent).toContain('第一句（不写入）');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    apply.click();
    expect(onApply).toHaveBeenCalledWith(['one']);
    toggle.click();
    expect(review.root.textContent).not.toContain('（不写入）');
    review.close();
  });

  it('says so when a draft has no speech, and offers only to close', () => {
    const review = openCaptionReview({ doc: document, draft: { ...draft, segments: [] }, projectRawUrl: path => path, onApply: () => {}, onClose: () => {} });
    expect(review.root.textContent).toContain('没有可靠的人声字幕草稿，现有字幕未改动。');
    expect(review.root.querySelector('[data-action="apply"]')).toBeNull();
    review.close();
  });
});

describe('listening to a line', () => {
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(1);
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    });
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'));
    });
  });

  const open = () => openCaptionReview({ doc: document, draft, projectRawUrl: path => `/api/projects/film-1/raw/${path}`, onApply: () => {}, onClose: () => {} });
  const line = (root: HTMLElement, text: string) => [...root.querySelectorAll<HTMLButtonElement>('.caption-row')].find(row => row.getAttribute('aria-label')?.endsWith(`: ${text}`))!;
  const audio = (root: HTMLElement) => root.querySelector('audio')!;

  it('plays a clicked line from its source time, pauses at its end and replays from its start', async () => {
    const { root, close } = open();
    expect(play).not.toHaveBeenCalled();
    line(root, '第一句').click();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(audio(root).getAttribute('src')).toBe('/api/projects/film-1/raw/canvas/media/a.wav');
    expect(audio(root).currentTime).toBe(3);
    expect(line(root, '第一句').getAttribute('aria-label')).toContain('暂停试听');
    audio(root).currentTime = 4;
    audio(root).dispatchEvent(new Event('timeupdate'));
    expect(line(root, '第一句').getAttribute('aria-label')).toContain('试听此句');
    line(root, '第一句').click();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(audio(root).currentTime).toBe(3);
    close();
    expect(pause).toHaveBeenCalled();
  });

  it('pauses the playing line on a second click and starts another line at its own time', async () => {
    const { root, close } = open();
    line(root, '第一句').click();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    line(root, '第一句').click();
    expect(play).toHaveBeenCalledTimes(1);
    expect(line(root, '第一句').getAttribute('aria-label')).toContain('试听此句');
    line(root, '第三句').click();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(audio(root).currentTime).toBe(9);
    close();
  });

  it('waits for a new file\'s metadata, and ignores metadata from a superseded selection', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(0);
    const { root, close } = open();
    line(root, '第二句').click();
    const previous = audio(root);
    expect(previous.getAttribute('src')).toContain('/b.wav');
    expect(play).not.toHaveBeenCalled();
    line(root, '第三句').click();
    previous.dispatchEvent(new Event('loadedmetadata'));
    expect(play).not.toHaveBeenCalled();
    audio(root).dispatchEvent(new Event('loadedmetadata'));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(audio(root).currentTime).toBe(9);
    close();
  });

  it('shows a playback failure and retries the same line on the next click', async () => {
    play.mockRejectedValueOnce(new Error('decode failed'));
    const { root, close } = open();
    const failure = () => [...root.querySelectorAll<HTMLElement>('.caption-alert')].find(node => node.textContent === '这句原声暂时无法播放，请再次点击重试。')!;
    line(root, '第一句').click();
    await vi.waitFor(() => expect(failure().hidden).toBe(false));
    line(root, '第一句').click();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(failure().hidden).toBe(true);
    close();
  });
});

describe('the engine question', () => {
  const offerOf = (overrides: Partial<EngineOffer> = {}): EngineOffer => ({ engines: engines(), preferred: 'whisper', estimateGateway: vi.fn(async () => quoted), ...overrides });

  it('preselects the preferred engine, greys out one that cannot run, and shows the plugin\'s estimate only for the gateway', async () => {
    const offer = offerOf({ engines: engines({ whisper: { available: false, reason: '需要一个打开着的 VibeDev 窗口', runner: 'none' } }) });
    const dialog = engineDialog(document, offer);
    expect(dialog.choices.get('whisper')!.disabled).toBe(true);
    expect(dialog.root.textContent).toContain('需要一个打开着的 VibeDev 窗口');
    expect(dialog.selected()).toBe('gateway');
    expect(dialog.cost.hidden).toBe(false);
    // Paying is not offered before the estimate is shown.
    expect(dialog.cost.textContent).toContain('正在估算网关费用');
    expect(dialog.confirm.disabled).toBe(true);
    await vi.waitFor(() => expect(dialog.confirm.disabled).toBe(false));
    expect(dialog.cost.textContent).toContain('估算：最多送去转写约 2.5 分钟原声（150 秒），约 ¥0.13');
    expect(dialog.cost.textContent).toContain('计价依据：网关价目表的单价');
    expect(dialog.cost.textContent).toContain(GATEWAY_NOTICE);
    expect(dialog.confirm.textContent).toBe('确认计费并识别');
    expect(offer.estimateGateway).toHaveBeenCalledTimes(1);

    const local = engineDialog(document, offerOf());
    expect(local.selected()).toBe('whisper');
    expect(local.cost.hidden).toBe(true);
    expect(local.confirm.textContent).toBe('开始识别');
    expect(local.root.textContent).toContain('第一次要下载识别模型（约 242.4 MB）');
    local.choices.get('gateway')!.checked = true;
    local.choices.get('gateway')!.dispatchEvent(new Event('change'));
    expect(local.cost.hidden).toBe(false);
  });

  it('shows a refused estimate and offers no paid recognition, asking again when the gateway is chosen again', async () => {
    const estimateGateway = vi.fn<EngineOffer['estimateGateway']>()
      .mockRejectedValueOnce(new HostRequestError('CAPTION_ENGINE_UNAVAILABLE: not signed in', 503, 'CAPTION_ENGINE_UNAVAILABLE', { cause: 'NOT_SIGNED_IN' }))
      .mockResolvedValueOnce({ seconds: 30, amountCny: 0.03, basis: 'retail ¥0.05 per minute × source seconds; an upper bound, only speech is sent' });
    const dialog = engineDialog(document, offerOf({ preferred: 'gateway', estimateGateway }));
    await vi.waitFor(() => expect(dialog.cost.textContent).toContain('估算不了网关费用，这次不能用网关转写：请先登录 VibeDev 账号'));
    expect(dialog.confirm.disabled).toBe(true);
    const pick = (engine: 'whisper' | 'gateway') => {
      dialog.choices.get(engine)!.checked = true;
      dialog.choices.get(engine)!.dispatchEvent(new Event('change'));
    };
    pick('whisper');
    expect(dialog.confirm.disabled).toBe(false);
    pick('gateway');
    await vi.waitFor(() => expect(dialog.confirm.disabled).toBe(false));
    expect(dialog.cost.textContent).toContain('约 0.5 分钟原声（30 秒），约 ¥0.03');
    expect(dialog.cost.textContent).toContain('计价依据：零售价每分钟 ¥0.05（读不到价目表时）');
    expect(estimateGateway).toHaveBeenCalledTimes(2);
  });

  it('offers nothing to confirm when no engine can run', () => {
    const dialog = engineDialog(document, offerOf({ engines: engines({ whisper: { available: false }, gateway: { available: false } }) }));
    expect(dialog.selected()).toBeNull();
    expect(dialog.confirm.disabled).toBe(true);
    expect(dialog.root.textContent).toContain('现在没有能用的识别方式');
  });

  it('answers the chosen engine, and nothing on Esc', async () => {
    const ask = createEnginePrompt(document);
    const first = ask(offerOf({ preferred: 'gateway' }));
    const confirm = document.querySelector('[data-action="confirm"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(confirm.disabled).toBe(false));
    confirm.click();
    expect(await first).toBe('gateway');
    const second = ask(offerOf());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await second).toBeNull();
    expect(document.querySelector('.consent')).toBeNull();
  });

  it('says an estimate is one, and passes an unknown basis through', () => {
    expect(estimateText({ seconds: 1, amountCny: 0.01, basis: 'flat rate' })).toBe('估算：最多送去转写约 0.1 分钟原声（1 秒），约 ¥0.01。只送有人声的片段，实际计费通常更少。计价依据：flat rate');
    expect(estimateText({ seconds: 60, basis: CATALOGUE_BASIS })).toBe('估算：最多送去转写约 1 分钟原声（60 秒）。只送有人声的片段，实际计费通常更少。计价依据：网关价目表的单价');
  });
});

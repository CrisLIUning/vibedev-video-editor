import { describe, expect, it, vi } from 'vitest';

import { runCaptionJob } from '../src/caption-runner.ts';
import type { CaptionRunnerJob, RunnerEditorModule } from '../src/caption-runner.ts';

const job: CaptionRunnerJob = {
  jobId: 'job-1',
  kind: 'whisper',
  language: 'zh',
  sources: [{ clipId: 'v1', url: '/api/dsh-film/caption-runner/source?job=job-1&i=0&t=abc', sourceIn: 2, sourceOut: 8 }],
  artifacts: { 'encoder-q8': '/api/dsh-film/models/whisper-small-q8/rev/encoder-q8', 'speech-vad': '/api/dsh-film/models/silero-vad/rev/speech-vad' },
};

/** The plugin's runner routes: the claim answers `claim`, progress answers `cancelled`, a result answers `result`. */
function fakeRoutes(options: { claim?: Response | (() => Response); cancelled?: () => boolean; result?: (body: Record<string, unknown>) => Response } = {}) {
  const posts: Array<{ route: string; body: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const route = url.replace('/api/dsh-film/caption-runner/', '');
    posts.push({ route, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (route === 'claim') {
      const claim = options.claim;
      return typeof claim === 'function' ? claim() : claim ?? new Response(JSON.stringify(job), { status: 200 });
    }
    if (route === 'progress') return new Response(JSON.stringify({ cancelled: options.cancelled?.() ?? false }));
    if (route === 'result' && options.result) return options.result(posts.at(-1)!.body);
    return new Response(JSON.stringify({ ok: true }));
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, posts };
}

const base = { jobId: 'job-1', runnerId: 'runner-7', root: new URL('http://host.test/api/dsh-film/'), progressMs: 5, heartbeatMs: 20 };

/** An editor whose recognition waits until it is released or aborted. */
function pendingEditor() {
  let release!: () => void;
  const started = vi.fn();
  const editor: RunnerEditorModule = {
    transcribeTimelineSources: (_input, onProgress, signal) => new Promise((resolve, reject) => {
      started();
      onProgress({ progress: 10, phase: '下载或读取 Whisper 模型' });
      signal.addEventListener('abort', () => { reject(signal.reason as Error); }, { once: true });
      release = () => { resolve([]); };
    }),
  };
  return { editor, started, release: () => release() };
}

describe('the caption runner page', () => {
  it('claims the job, runs Whisper on it, reports progress and posts the result', async () => {
    const { fetch, posts } = fakeRoutes();
    const result = [{ sourceClipId: 'v1', segments: [{ text: '借个火', start: 0.5, end: 1.4 }], diagnostics: { duration: 6 } }];
    const transcribe = vi.fn<RunnerEditorModule['transcribeTimelineSources']>(async (_input, onProgress) => {
      onProgress({ progress: 50, phase: '按 zh 转写字幕' });
      await new Promise(resolve => setTimeout(resolve, 30));
      return result;
    });
    const outcome = await runCaptionJob({ ...base, fetch, loadEditor: async () => ({ transcribeTimelineSources: transcribe }) });
    expect(outcome).toBe('done');
    expect(posts[0]).toEqual({ route: 'claim', body: { runnerId: 'runner-7', jobId: 'job-1' } });
    expect(transcribe).toHaveBeenCalledWith({ sources: job.sources, artifacts: job.artifacts, language: 'zh' }, expect.any(Function), expect.any(AbortSignal));
    expect(posts.filter(post => post.route === 'progress').map(post => post.body)).toContainEqual({ runnerId: 'runner-7', jobId: 'job-1', progress: 0.5, phase: '按 zh 转写字幕' });
    expect(posts.at(-1)).toEqual({ route: 'result', body: { runnerId: 'runner-7', jobId: 'job-1', result } });
  });

  it('runs only Whisper: a job of another kind fails, said so, without loading the editor', async () => {
    const { fetch, posts } = fakeRoutes({ claim: () => new Response(JSON.stringify({ ...job, kind: 'translate' })) });
    const loadEditor = vi.fn(async () => ({ transcribeTimelineSources: vi.fn() }));
    expect(await runCaptionJob({ ...base, fetch, loadEditor })).toBe('failed');
    expect(loadEditor).not.toHaveBeenCalled();
    expect(String(posts.at(-1)?.body.error)).toMatch(/^CAPTION_RUNTIME_FAILED: .*translate/);

    // A claim that names no kind is a Whisper job.
    const { kind: _kind, ...unnamed } = job;
    const plain = fakeRoutes({ claim: () => new Response(JSON.stringify(unnamed)) });
    const transcribe = vi.fn<RunnerEditorModule['transcribeTimelineSources']>(async () => []);
    expect(await runCaptionJob({ ...base, fetch: plain.fetch, loadEditor: async () => ({ transcribeTimelineSources: transcribe }) })).toBe('done');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing when another window claimed the job', async () => {
    const { fetch, posts } = fakeRoutes({ claim: new Response(JSON.stringify({ error: 'claimed', code: 'CAPTION_JOB_CLAIMED' }), { status: 409 }) });
    const loadEditor = vi.fn();
    expect(await runCaptionJob({ ...base, fetch, loadEditor })).toBe('refused');
    expect(loadEditor).not.toHaveBeenCalled();
    expect(posts.map(post => post.route)).toEqual(['claim']);
  });

  it('posts the error a failed recognition gives, with its code', async () => {
    const { fetch, posts } = fakeRoutes();
    const editor: RunnerEditorModule = {
      transcribeTimelineSources: async () => { throw Object.assign(new Error('decode failed'), { code: 'CAPTION_SAMPLE_RATE_INVALID' }); },
    };
    expect(await runCaptionJob({ ...base, fetch, loadEditor: async () => editor })).toBe('failed');
    expect(posts.at(-1)).toEqual({ route: 'result', body: { runnerId: 'runner-7', jobId: 'job-1', error: 'CAPTION_SAMPLE_RATE_INVALID: decode failed' } });
  });

  it('fails, and posts the refusal as its error, when the plugin does not take the result', async () => {
    const { fetch, posts } = fakeRoutes({
      result: body => ('error' in body
        ? new Response(JSON.stringify({ ok: true }))
        : new Response(JSON.stringify({ error: 'result too large', code: 'CAPTION_RUNNER_REQUEST_TOO_LARGE' }), { status: 413 })),
    });
    const result = [{ sourceClipId: 'v1', segments: [], diagnostics: { duration: 6 } }];
    expect(await runCaptionJob({ ...base, fetch, loadEditor: async () => ({ transcribeTimelineSources: async () => result }) })).toBe('failed');
    expect(posts.filter(post => post.route === 'result').map(post => post.body)).toEqual([
      { runnerId: 'runner-7', jobId: 'job-1', result },
      { runnerId: 'runner-7', jobId: 'job-1', error: 'CAPTION_RUNNER_REQUEST_TOO_LARGE: 识别结果没有被接收（413）：result too large' },
    ]);

    // A refusal without a body still fails, by its status.
    const bare = fakeRoutes({ result: () => new Response('', { status: 502 }) });
    expect(await runCaptionJob({ ...base, fetch: bare.fetch, loadEditor: async () => ({ transcribeTimelineSources: async () => [] }) })).toBe('failed');
    expect(bare.posts.at(-1)?.body.error).toBe('CAPTION_RESULT_REJECTED: 识别结果没有被接收（502）：HTTP 502');
  });

  it('stops when the progress answer says the task was cancelled, and posts nothing after', async () => {
    let cancelled = false;
    const { fetch, posts } = fakeRoutes({ cancelled: () => cancelled });
    const { editor, started } = pendingEditor();
    const running = runCaptionJob({ ...base, fetch, loadEditor: async () => editor });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    cancelled = true;
    expect(await running).toBe('cancelled');
    expect(posts.some(post => post.route === 'result')).toBe(false);
  });

  it('stops when the client half forwards a cancel', async () => {
    const { fetch, posts } = fakeRoutes();
    const { editor, started } = pendingEditor();
    const cancel = new AbortController();
    const running = runCaptionJob({ ...base, fetch, cancel: cancel.signal, loadEditor: async () => editor });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    cancel.abort();
    expect(await running).toBe('cancelled');
    expect(posts.some(post => post.route === 'result')).toBe(false);
  });

  it('reports progress at most every interval, and keeps reporting while nothing moves', async () => {
    const { fetch, posts } = fakeRoutes();
    let release!: () => void;
    const editor: RunnerEditorModule = {
      transcribeTimelineSources: (_input, onProgress) => new Promise((resolve) => {
        for (let step = 0; step <= 100; step += 1) onProgress({ progress: step, phase: '识别' });
        release = () => { resolve([]); };
      }),
    };
    const running = runCaptionJob({ ...base, progressMs: 25, heartbeatMs: 60, fetch, loadEditor: async () => editor });
    await new Promise(resolve => setTimeout(resolve, 200));
    const reports = posts.filter(post => post.route === 'progress');
    // 101 updates in one burst: the first report, then the latest value, then heartbeats.
    expect(reports.length).toBeGreaterThanOrEqual(3);
    expect(reports.length).toBeLessThan(12);
    expect(reports.map(post => post.body.progress)).toContain(1);
    release();
    expect(await running).toBe('done');
  });
});

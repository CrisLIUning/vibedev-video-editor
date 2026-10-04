/**
 * The caption runner page: one speech-recognition job, run in a hidden page.
 *
 * dsh-film's Host has no browser of its own, and Whisper runs in the editor
 * bundle's worker (AudioContext decoding, ONNX in WebAssembly). So when a
 * recognition starts, the plugin's client half mounts this page, hidden, in a
 * DSH window (`caption-runner.html?job=<jobId>&runner=<runnerId>`), and the
 * page does what Studio's headless editor page did:
 *
 *   1. claim the job (`POST /api/dsh-film/caption-runner/claim`); 409 means
 *      another window took it, and this page has nothing to do;
 *   2. load `video-editor.js` from its own folder and run Whisper on the job
 *      (`transcribeTimelineSources`);
 *   3. report progress about every 250 ms (`…/progress`), stopping when the
 *      answer says the task was cancelled;
 *   4. post the result or the error (`…/result`); a result the plugin does
 *      not accept is a failure, and its refusal is posted as the error.
 *
 * The Host keeps the task, the source snapshots, the models and the mapping
 * onto the timeline; this page only listens. A cancel also arrives from the
 * client half as `postMessage({ type: 'cancel', jobId })`, and the page tells
 * the client half when it is finished (`{ type: 'caption-runner', jobId, state }`)
 * so the frame can go.
 */

import type { CaptionJobInput, TimelineSourceRecognition } from '../../packages/video-editor-bridge/src/caption-job.ts';
import { pluginRoot } from './address.ts';

type Progress = (update: { progress: number; phase: string }) => void;

/** What the runner uses from the editor bundle (`editor-entry.jsx`). */
export interface RunnerEditorModule {
  transcribeTimelineSources(input: CaptionJobInput, onProgress: Progress, signal: AbortSignal): Promise<TimelineSourceRecognition[]>;
}

/** The job as the claim answers it. */
export interface CaptionRunnerJob extends CaptionJobInput {
  jobId: string;
  kind: 'whisper';
}

/** How a job ended for this page. */
export type RunnerOutcome = 'done' | 'failed' | 'cancelled' | 'refused';

export interface RunnerOptions {
  jobId: string;
  runnerId: string;
  /** The plugin's API root (`/api/dsh-film/`). */
  root: URL;
  loadEditor(): Promise<RunnerEditorModule>;
  fetch?: typeof fetch;
  /** Aborts when the client half forwards a cancel. */
  cancel?: AbortSignal;
  /** How often progress may be posted, and how long the page may stay silent. */
  progressMs?: number;
  heartbeatMs?: number;
  now?(): number;
}

const PROGRESS_MS = 250;
const HEARTBEAT_MS = 2000;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '' && !message.includes(code) ? `${code}: ${message}` : message;
}

/** A result the plugin did not accept, as the error the page reports: its refusal, or the status. */
async function rejectedResult(response: Response): Promise<Error> {
  const answer = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  const reason = typeof answer?.error === 'string' && answer.error !== '' ? answer.error : `HTTP ${response.status}`;
  const code = typeof answer?.code === 'string' && answer.code !== '' ? answer.code : 'CAPTION_RESULT_REJECTED';
  return Object.assign(new Error(`识别结果没有被接收（${response.status}）：${reason}`), { code });
}

/**
 * Run one job to its end.
 * @returns how it ended; `refused` when the claim was not granted (nothing is posted then).
 */
export async function runCaptionJob(options: RunnerOptions): Promise<RunnerOutcome> {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const post = (path: string, body: unknown): Promise<Response> => send(new URL(`caption-runner/${path}`, options.root).pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const ids = { runnerId: options.runnerId, jobId: options.jobId };

  let job: CaptionRunnerJob;
  try {
    const claimed = await post('claim', ids);
    if (!claimed.ok) return 'refused';
    job = await claimed.json() as CaptionRunnerJob;
  } catch {
    return 'refused';
  }

  const controller = new AbortController();
  let cancelled = false;
  const stop = (): void => {
    cancelled = true;
    controller.abort(new DOMException('识别已取消', 'AbortError'));
  };
  if (options.cancel?.aborted) stop();
  options.cancel?.addEventListener('abort', stop, { once: true });

  // Progress is posted at most every `progressMs`, and at least every
  // `heartbeatMs` even when nothing moved (a model loading): the answer is how
  // a cancel reaches a page whose client half missed it.
  let latest = { progress: 0, phase: '准备识别' };
  let changed = true;
  let sentAt = -Infinity;
  let inFlight = false;
  const report = (): void => {
    if (inFlight || cancelled) return;
    if (!changed && now() - sentAt < (options.heartbeatMs ?? HEARTBEAT_MS)) return;
    inFlight = true;
    changed = false;
    sentAt = now();
    post('progress', { ...ids, ...latest })
      .then(async (response) => {
        if (!response.ok) return;
        const answer = await response.json().catch(() => null) as { cancelled?: unknown } | null;
        if (answer?.cancelled === true) stop();
      })
      .catch(() => { /* a lost report is sent again with the next one */ })
      .finally(() => { inFlight = false; });
  };
  const ticker = setInterval(report, options.progressMs ?? PROGRESS_MS);
  const onProgress: Progress = (update) => {
    const progress = Math.min(1, Math.max(0, (Number(update.progress) || 0) / 100));
    if (progress === latest.progress && update.phase === latest.phase) return;
    latest = { progress, phase: String(update.phase ?? '') };
    changed = true;
  };
  report();

  try {
    controller.signal.throwIfAborted();
    // The page runs Whisper and nothing else: a job that names another kind
    // fails here, said so, instead of having Whisper's answer posted for it.
    const kind = (job as { kind?: unknown }).kind;
    if (kind !== undefined && kind !== 'whisper') throw new Error(`CAPTION_RUNTIME_FAILED: 识别页只跑本机 Whisper 识别，不认识任务类型 ${String(kind)}`);
    const editor = await options.loadEditor();
    const input: CaptionJobInput = { sources: job.sources, artifacts: job.artifacts ?? {}, language: job.language };
    const result = await editor.transcribeTimelineSources(input, onProgress, controller.signal);
    if (cancelled) return 'cancelled';
    clearInterval(ticker);
    // Done only when the plugin took the result; a refused one (too large, a
    // job it no longer has) is this page's failure, reported like any other.
    const posted = await post('result', { ...ids, result });
    if (!posted.ok) throw await rejectedResult(posted);
    return 'done';
  } catch (error) {
    if (cancelled) return 'cancelled';
    clearInterval(ticker);
    await post('result', { ...ids, error: errorText(error) }).catch(() => undefined);
    return 'failed';
  } finally {
    clearInterval(ticker);
    options.cancel?.removeEventListener('abort', stop);
  }
}

/** The page's own start: read the job from the address, listen for a cancel, run, tell the client half. */
function start(jobId: string, runnerId: string): void {
  const cancel = new AbortController();
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data as { type?: unknown; jobId?: unknown } | null;
    if (data?.type === 'cancel' && data.jobId === jobId) cancel.abort();
  });
  void runCaptionJob({
    jobId,
    runnerId,
    root: pluginRoot(),
    cancel: cancel.signal,
    loadEditor: async () => await import(/* @vite-ignore */ new URL('video-editor.js', location.href).href) as RunnerEditorModule,
  }).then((state) => {
    if (window.parent !== window) window.parent.postMessage({ type: 'caption-runner', jobId, state }, location.origin);
  });
}

if (typeof location !== 'undefined' && /\/caption-runner\.html$/.test(location.pathname)) {
  const query = new URLSearchParams(location.search);
  const jobId = query.get('job');
  const runnerId = query.get('runner');
  if (jobId && runnerId) start(jobId, runnerId);
}

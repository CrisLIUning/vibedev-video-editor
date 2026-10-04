/**
 * Original-audio captions on the editing desk (Studio's `useTimelineCaptions`
 * and `TimelineCaptionReview`, in the page's own DOM).
 *
 * The CC buttons do not caption anything here: they submit a background
 * recognition of the saved cut to dsh-film and come back at once. The plugin
 * owns the task — it outlives this tab and goes on with the editor closed —
 * and keeps an unreviewed draft. This page lists the film's recognitions in a
 * small panel, opens a finished draft for review (each line plays its stretch
 * of the original audio), and writes the reviewed lines into their ranges
 * with a dry run first. Nothing reaches the timeline unreviewed.
 *
 * Recognition is Whisper on this machine: the plugin runs it in a hidden page
 * of a DSH window (`caption-runner.ts`), after the person agreed to download
 * its models, and the audio does not leave the machine.
 */

import type { VideoEditorCapabilityRuntime } from '../../packages/video-editor-bridge/src/host-contract.ts';
import { HostRequestError, TimelineConflictError } from './api.ts';
import type {
  CaptionDraft,
  CaptionEngines,
  CaptionTaskSummary,
  CommandResult,
  TaskSnapshot,
  TimelineState,
  TranscribeBody,
  TranscriptionStarted,
} from './api.ts';
import { codeOf, describeRefusal } from './refusals.ts';
import type { NoticeTone } from './session.ts';

/** The models local recognition needs, asked about in this order (Studio's). */
export const CAPTION_MODELS = ['whisper-small-q8', 'silero-vad'] as const;

/** Polling while a recognition runs, and while none does (Studio's). */
const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 15_000;

const STRINGS = {
  title: '后台字幕识别',
  hint: '可继续剪辑或切换页面；请保持 VibeDev 运行。草稿不会自动写入时间线。',
  draftReady: '识别完成，待校对',
  openDraft: '查看草稿',
  later: '稍后校对',
  refresh: '刷新状态',
  cancel: '取消',
  cancelled: '已取消',
  omit: '排除选中句',
  restore: '保留选中句',
  omitted: '不写入',
  noSpeech: '没有可靠的人声字幕草稿，现有字幕未改动。',
  suspicious: '人声证据较弱，请试听',
  reviewTitle: '原声字幕草稿',
  playLine: '试听此句',
  pauseLine: '暂停试听',
  playFailed: '这句原声暂时无法播放，请再次点击重试。',
  reviewHint: '点击字幕试听对应原声，再次点击可暂停；播完后可点击重听。请核对后再应用，音乐、静音不能当作可信对白。',
  reviewChecked: '已按原声核对字幕',
  apply: '应用到指定范围',
  busy: '字幕识别正在进行',
  music: '不能把音乐当作对白，请选择视频原声或对白音频。',
  preparing: '正在准备原声识别…',
  failed: '未返回可用的识别草稿',
  applied: '字幕已写入时间线',
  stale: '这份草稿识别之后剪辑又改过了，不能直接写入；请重新识别这一段',
  finished: '原声字幕草稿识别好了，可以在右下角打开校对',
  noRunner: '本机识别需要一个打开着的 VibeDev 窗口',
  unavailable: '本机识别现在用不了',
} as const;

/** The plugin calls the flow makes (`api.ts`). */
export interface CaptionHost {
  getCaptionEngines(): Promise<CaptionEngines>;
  startTranscription(body: TranscribeBody): Promise<TranscriptionStarted>;
  listCaptionTasks(signal?: AbortSignal): Promise<{ tasks: CaptionTaskSummary[] }>;
  waitTask(taskId: string, since: number, timeoutMs: number, signal?: AbortSignal): Promise<TaskSnapshot<{ documentResult?: unknown }>>;
  cancelTask(taskId: string): Promise<unknown>;
  applyCaptions(body: { taskId: string; reviewed: boolean; dryRun: boolean; excludeSegmentIds?: string[] }): Promise<CommandResult>;
  projectRawUrl(path: string): string;
}

export interface CaptionFlowOptions {
  host: CaptionHost;
  /** The consent question (`models.ts`); rejects with an AbortError when declined. */
  ensureModelConsent(modelId: string, signal?: AbortSignal): Promise<void>;
  /** Save what is pending and give the revision the cut is at. */
  prepareTimeline(): Promise<number>;
  /** Show the cut a conflict handed back. */
  adoptTimeline(state: TimelineState): void;
  /** Re-read the cut after captions were written. */
  reloadTimeline(): Promise<void>;
  notify(message: string, tone: NoticeTone): void;
  doc?: Document;
  activePollMs?: number;
  idlePollMs?: number;
}

type TranscribeTimeline = NonNullable<VideoEditorCapabilityRuntime['transcribeTimeline']>;

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attributes: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

const abortError = (message: string = STRINGS.cancelled): DOMException => new DOMException(message, 'AbortError');
const isAbort = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'AbortError';
const isConflict = (error: unknown): boolean => error instanceof TimelineConflictError || (codeOf(error) ?? '').startsWith('CANVAS_TIMELINE_CONFLICT');

/** A refusal as an error the editor shows: the Chinese wording, the code kept. */
function refusal(error: unknown): Error {
  const failure = new Error(describeRefusal(error)) as Error & { code?: string };
  const code = codeOf(error);
  if (code !== null) failure.code = code;
  return failure;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** What a line's warnings mean for the person. */
function warningLabel(warnings: readonly string[] | undefined): string | null {
  return warnings?.length ? STRINGS.suspicious : null;
}

/** The review of one draft, open over the editor. */
export interface CaptionReview {
  root: HTMLElement;
  update(state: { applying?: boolean; error?: string }): void;
  close(): void;
}

/**
 * Open a draft for review (exported for tests). Each line plays its stretch of
 * the original file — from `sourceIn`, pausing at `sourceOut` — and a click on
 * the playing line pauses it. The selected line can be left out; applying
 * needs the "checked against the original" box, and is not offered when
 * every line is left out.
 */
export function openCaptionReview(options: {
  doc: Document;
  draft: CaptionDraft;
  projectRawUrl(path: string): string;
  onApply(excluded: string[]): void;
  onClose(): void;
}): CaptionReview {
  const { doc, draft } = options;
  const segments = draft.segments;
  let checked = false;
  const excluded = new Set<string>();
  let active = 0;
  let playing = false;
  let playError = false;
  let applying = false;
  let error = '';
  let request = 0;
  let audio: HTMLAudioElement | null = null;
  let audioSrc = '';
  let frame = 0;

  const root = element(doc, 'div', { class: 'consent caption-review', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'caption-review-title' });
  const card = element(doc, 'div', { class: 'consent-card caption-review-card' });
  root.append(card);
  card.append(element(doc, 'h2', { id: 'caption-review-title' }, STRINGS.reviewTitle));
  const alert = element(doc, 'p', { class: 'caption-alert', role: 'alert' });
  card.append(alert, element(doc, 'p', { class: 'consent-lead' }, STRINGS.reviewHint));
  if (segments.length === 0) card.append(element(doc, 'p', { role: 'status' }, STRINGS.noSpeech));
  const players = element(doc, 'div', { hidden: '' });
  const playAlert = element(doc, 'p', { class: 'caption-alert', role: 'alert' }, STRINGS.playFailed);
  const rows = element(doc, 'div', { class: 'caption-rows' });
  card.append(players, playAlert, rows);
  const toggle = element(doc, 'button', { type: 'button', class: 'caption-toggle' });
  const checkLabel = element(doc, 'label', { class: 'consent-group caption-check' });
  const checkbox = element(doc, 'input', { type: 'checkbox' });
  checkLabel.append(checkbox, STRINGS.reviewChecked);
  if (segments.length > 0) card.append(toggle, checkLabel);
  const actions = element(doc, 'div', { class: 'consent-actions' });
  const later = element(doc, 'button', { type: 'button', 'data-action': 'later' }, STRINGS.later);
  const apply = element(doc, 'button', { type: 'button', 'data-action': 'apply', class: 'primary' }, STRINGS.apply);
  actions.append(later);
  if (segments.length > 0) actions.append(apply);
  card.append(actions);

  const rowButtons = segments.map((segment, index) => {
    const button = element(doc, 'button', { type: 'button', class: 'caption-row' });
    button.addEventListener('click', () => { select(index); });
    rows.append(button);
    return button;
  });

  function render(): void {
    alert.hidden = error === '';
    alert.textContent = error;
    playAlert.hidden = !playError;
    for (const [index, button] of rowButtons.entries()) {
      const segment = segments[index]!;
      const current = index === active;
      const marks = [warningLabel(segment.warnings), excluded.has(segment.id) ? STRINGS.omitted : null].filter(Boolean).map(mark => `（${mark}）`).join('');
      button.setAttribute('aria-pressed', String(current));
      button.setAttribute('aria-label', `${current && playing ? STRINGS.pauseLine : STRINGS.playLine}: ${segment.text}`);
      button.replaceChildren(
        element(doc, 'span', { class: 'caption-play', 'aria-hidden': 'true' }, current && playing ? '❚❚' : '▶'),
        element(doc, 'time', {}, `${segment.start.toFixed(2)}–${segment.end.toFixed(2)}s`),
        element(doc, 'span', {}, `${segment.text}${marks}`),
      );
    }
    const selected = segments[active];
    toggle.hidden = selected === undefined;
    toggle.textContent = selected !== undefined && excluded.has(selected.id) ? STRINGS.restore : STRINGS.omit;
    toggle.disabled = applying;
    checkbox.checked = checked;
    checkbox.disabled = applying;
    later.disabled = applying;
    apply.disabled = !checked || applying || excluded.size === segments.length;
  }

  const stopTicking = (): void => {
    if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = 0;
  };
  const reachedEnd = (): boolean => {
    const segment = segments[active];
    if (!audio || !segment || audio.currentTime < segment.sourceOut) return false;
    audio.pause();
    playing = false;
    stopTicking();
    render();
    return true;
  };
  const tick = (): void => {
    frame = 0;
    if (!playing || reachedEnd()) return;
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick);
  };

  /** The player for a source file: a new element per file, so a superseded file's metadata cannot start the new line. */
  const playerFor = (src: string): HTMLAudioElement => {
    if (audio && audioSrc === src) return audio;
    audio?.pause();
    audio?.remove();
    const player = element(doc, 'audio', { preload: 'metadata' });
    player.addEventListener('playing', () => {
      if (player !== audio) return;
      playing = true;
      render();
      tick();
    });
    const stopped = (): void => {
      if (player !== audio) return;
      playing = false;
      stopTicking();
      render();
    };
    player.addEventListener('pause', stopped);
    player.addEventListener('ended', stopped);
    player.addEventListener('error', () => {
      if (player !== audio) return;
      playError = true;
      stopped();
    });
    player.addEventListener('timeupdate', () => { if (player === audio) reachedEnd(); });
    player.setAttribute('src', src);
    players.append(player);
    audio = player;
    audioSrc = src;
    return player;
  };

  function select(index: number): void {
    if (index === active && playing) {
      audio?.pause();
      playing = false;
      render();
      return;
    }
    audio?.pause();
    playing = false;
    active = index;
    const segment = segments[index]!;
    const source = draft.sources.find(item => item.clipId === segment.sourceClipId);
    request += 1;
    const turn = request;
    if (!source) {
      playError = true;
      render();
      return;
    }
    playError = false;
    const player = playerFor(options.projectRawUrl(source.file));
    const start = (): void => {
      if (turn !== request || player !== audio) return;
      try {
        player.currentTime = segment.sourceIn;
        void player.play().catch(() => {
          if (turn !== request) return;
          playing = false;
          playError = true;
          render();
        });
      } catch {
        playError = true;
        render();
      }
    };
    // A file that has not loaded its metadata cannot seek yet; seeking the
    // old file and then playing the new one from zero would play the wrong line.
    if (player.readyState >= 1) start();
    else player.addEventListener('loadedmetadata', start, { once: true });
    render();
  }

  toggle.addEventListener('click', () => {
    const segment = segments[active];
    if (!segment) return;
    checked = false;
    if (excluded.has(segment.id)) excluded.delete(segment.id);
    else excluded.add(segment.id);
    render();
  });
  checkbox.addEventListener('change', () => {
    checked = checkbox.checked;
    render();
  });

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    request += 1;
    stopTicking();
    audio?.pause();
    doc.removeEventListener('keydown', onKey, true);
    root.remove();
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || applying) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    options.onClose();
  }
  later.addEventListener('click', () => {
    if (applying) return;
    close();
    options.onClose();
  });
  apply.addEventListener('click', () => {
    if (apply.disabled) return;
    options.onApply([...excluded]);
  });
  doc.addEventListener('keydown', onKey, true);
  doc.body.append(root);
  render();
  (rowButtons[0] ?? later).focus();

  return {
    root,
    update(state) {
      if (state.applying !== undefined) applying = state.applying;
      if (state.error !== undefined) error = state.error;
      if (!closed) render();
    },
    close,
  };
}

/** The status line of a recognition in the panel. */
function statusText(task: CaptionTaskSummary, detail: { progress?: string; error?: CaptionTaskSummary['error'] } | undefined): string {
  const error = task.error ?? detail?.error ?? null;
  if (task.status === 'done') return typeof task.segments === 'number' ? `识别完成，${task.segments} 句待校对` : STRINGS.draftReady;
  if (task.status === 'interrupted') return error ? describeRefusal(error) : STRINGS.cancelled;
  if (task.status === 'failed') return error ? describeRefusal(error) : STRINGS.failed;
  return task.progress?.at(-1) ?? detail?.progress ?? STRINGS.preparing;
}

/**
 * The CC flow, the background panel and the review, for one open film.
 * @returns the editor's `transcribeTimeline`, and controls for the page.
 */
export function createCaptionFlow(options: CaptionFlowOptions): {
  transcribeTimeline: TranscribeTimeline;
  refresh(): void;
  openReview(taskId: string): Promise<void>;
  panel: HTMLElement;
  dispose(): void;
} {
  const doc = options.doc ?? document;
  const host = options.host;
  const activePoll = options.activePollMs ?? ACTIVE_POLL_MS;
  const idlePoll = options.idlePollMs ?? IDLE_POLL_MS;

  let disposed = false;
  let submitting = false;
  let applying = false;
  let tasks: CaptionTaskSummary[] = [];
  let error = '';
  let pollError = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading: AbortController | null = null;
  let generation = 0;
  let reviewSequence = 0;
  let review: CaptionReview | null = null;
  /** The last status seen per task, to tell the person once when a recognition finishes. */
  const seen = new Map<string, CaptionTaskSummary['status']>();
  let primed = false;
  /** Progress and errors read from a task's own snapshot, for summaries that leave them out. */
  const details = new Map<string, { progress?: string; error?: CaptionTaskSummary['error'] }>();

  const panel = element(doc, 'section', { class: 'caption-panel', 'aria-label': STRINGS.title });
  panel.hidden = true;
  doc.body.append(panel);

  function renderPanel(): void {
    const open = tasks.filter(task => !task.applied);
    const message = error || pollError;
    panel.hidden = open.length === 0 && message === '';
    const heading = element(doc, 'div', { class: 'caption-panel-head' });
    heading.append(element(doc, 'strong', {}, STRINGS.title), element(doc, 'span', {}, STRINGS.hint));
    const children: Node[] = [heading];
    if (message !== '') {
      const alert = element(doc, 'div', { class: 'caption-alert', role: 'alert' }, message);
      const again = element(doc, 'button', { type: 'button' }, STRINGS.refresh);
      again.addEventListener('click', () => {
        error = '';
        refresh();
      });
      alert.append(' ', again);
      children.push(alert);
    }
    for (const task of open) {
      const row = element(doc, 'div', { class: 'caption-task', 'data-task': task.taskId });
      const started = new Date(task.startedAt);
      row.append(
        element(doc, 'time', { datetime: Number.isFinite(started.getTime()) ? started.toISOString() : '' }, started.toLocaleString()),
        element(doc, 'span', { 'aria-live': 'polite' }, statusText(task, details.get(task.taskId))),
      );
      if (task.status === 'done') {
        const view = element(doc, 'button', { type: 'button', 'data-action': 'open' }, STRINGS.openDraft);
        view.disabled = applying;
        view.addEventListener('click', () => { void openReview(task.taskId); });
        row.append(view);
      }
      if (task.status === 'queued' || task.status === 'running') {
        const cancel = element(doc, 'button', { type: 'button', 'data-action': 'cancel' }, STRINGS.cancel);
        cancel.addEventListener('click', () => { void cancelTask(task.taskId); });
        row.append(cancel);
      }
      children.push(row);
    }
    panel.replaceChildren(...children);
  }

  /** Fill in progress and errors the summaries leave out, from each task's own snapshot. */
  async function readDetails(open: CaptionTaskSummary[], signal: AbortSignal): Promise<void> {
    await Promise.all(open.map(async (task) => {
      const running = task.status === 'queued' || task.status === 'running';
      const ended = task.status === 'failed' || task.status === 'interrupted';
      if (running ? task.progress !== undefined : !ended || task.error !== undefined || details.has(task.taskId)) return;
      try {
        const snapshot = await host.waitTask(task.taskId, 0, 0, signal);
        details.set(task.taskId, { ...(snapshot.progress.length > 0 ? { progress: snapshot.progress.at(-1)! } : {}), error: snapshot.error ?? null });
      } catch {
        // A missing detail is a plainer status line, not a broken panel.
      }
    }));
  }

  function announce(next: CaptionTaskSummary[]): void {
    for (const task of next) {
      const before = seen.get(task.taskId);
      seen.set(task.taskId, task.status);
      if (!primed || task.applied || before === task.status) continue;
      if ((before === 'running' || before === 'queued' || before === undefined) && task.status === 'done') options.notify(STRINGS.finished, 'success');
      else if ((before === 'running' || before === 'queued') && task.status === 'failed') options.notify(`字幕识别没有完成：${statusText(task, details.get(task.taskId))}`, 'error');
    }
    primed = true;
  }

  async function load(): Promise<void> {
    clearTimeout(timer);
    loading?.abort();
    const controller = new AbortController();
    loading = controller;
    const turn = ++generation;
    try {
      // A plugin without recognition has no list: that is no recognitions, not a fault worth a panel.
      const answer = await host.listCaptionTasks(controller.signal).catch((failure: unknown) => {
        if (failure instanceof HostRequestError && failure.status === 404) return { tasks: [] };
        throw failure;
      });
      if (disposed || turn !== generation) return;
      await readDetails(answer.tasks.filter(task => !task.applied), controller.signal);
      if (disposed || turn !== generation) return;
      tasks = answer.tasks;
      pollError = '';
      announce(tasks);
      renderPanel();
      const running = tasks.some(task => task.status === 'queued' || task.status === 'running');
      timer = setTimeout(() => { void load(); }, running ? activePoll : idlePoll);
    } catch (failure) {
      if (disposed || turn !== generation || isAbort(failure)) return;
      pollError = describeRefusal(failure);
      renderPanel();
      // A plugin that did not answer once is asked again, at the idle pace.
      timer = setTimeout(() => { void load(); }, idlePoll);
    }
  }

  function refresh(): void {
    if (!disposed) void load();
  }

  async function cancelTask(taskId: string): Promise<void> {
    try {
      await host.cancelTask(taskId);
      refresh();
    } catch (failure) {
      error = describeRefusal(failure);
      renderPanel();
    }
  }

  async function openReview(taskId: string): Promise<void> {
    const sequence = ++reviewSequence;
    try {
      const snapshot = await host.waitTask(taskId, 0, 1000);
      if (disposed || sequence !== reviewSequence) return;
      const draft = snapshot.file?.documentResult as CaptionDraft | undefined;
      if (snapshot.status !== 'done' || draft?.kind !== 'timeline-caption-draft') throw new Error(STRINGS.failed);
      error = '';
      renderPanel();
      review?.close();
      const opened = openCaptionReview({
        doc,
        draft,
        projectRawUrl: host.projectRawUrl,
        onApply: excluded => { void applyDraft(taskId, excluded, opened); },
        onClose: () => { if (review === opened) review = null; },
      });
      review = opened;
    } catch (failure) {
      if (disposed || sequence !== reviewSequence) return;
      error = describeRefusal(failure);
      renderPanel();
    }
  }

  /** Save first, check with a dry run, then write; the cut on screen is re-read from what was committed. */
  async function applyDraft(taskId: string, excluded: string[], opened: CaptionReview): Promise<void> {
    if (applying) return;
    applying = true;
    opened.update({ applying: true, error: '' });
    renderPanel();
    try {
      await options.prepareTimeline();
      const body = { taskId, reviewed: true, excludeSegmentIds: excluded };
      await host.applyCaptions({ ...body, dryRun: true });
      await host.applyCaptions({ ...body, dryRun: false });
      opened.close();
      if (review === opened) review = null;
      refresh();
      await options.reloadTimeline().catch(() => undefined);
      options.notify(STRINGS.applied, 'success');
    } catch (failure) {
      opened.update({ error: isConflict(failure) ? STRINGS.stale : describeRefusal(failure) });
    } finally {
      applying = false;
      opened.update({ applying: false });
      renderPanel();
    }
  }

  const transcribeTimeline: TranscribeTimeline = async (request) => {
    if (disposed) throw abortError('剪辑台已关闭');
    if (submitting) throw new Error(STRINGS.busy);
    if (request.track === 'music') throw new Error(STRINGS.music);
    submitting = true;
    try {
      let engines: CaptionEngines;
      try {
        engines = await host.getCaptionEngines();
      } catch (failure) {
        throw refusal(failure);
      }
      // Whisper runs on this machine, in a hidden page of a DSH window: when it
      // cannot run now, say why instead of asking about models it would not use.
      const whisper = engines.engines.find(engine => engine.id === 'whisper');
      if (!whisper?.available) throw new Error(whisper?.reason || (whisper?.runner === 'none' ? STRINGS.noRunner : STRINGS.unavailable));
      // Short and explicit: every model recognition needs is asked about before
      // anything is sent; the plugin downloads and prepares them itself.
      for (const modelId of CAPTION_MODELS) {
        if (whisper.consent?.[modelId] !== true) await options.ensureModelConsent(modelId);
      }
      const body: Omit<TranscribeBody, 'baseRevision' | 'requestId'> = {
        ...(request.language ? { language: request.language } : {}),
        ...(request.clipId ? { clipIds: [request.clipId] } : {}),
        ...(finite(request.start) && finite(request.duration) ? { range: { start: request.start, end: request.start + request.duration } } : {}),
      };
      // One retry for a cut that moved on and one for a consent refusal, each on its own.
      let conflictRetried = false;
      let consentRetried = false;
      const submit = async (): Promise<TranscriptionStarted> => {
        const baseRevision = await options.prepareTimeline();
        try {
          return await host.startTranscription({ ...body, baseRevision, requestId: crypto.randomUUID() });
        } catch (failure) {
          // Recognition reads the saved cut and never edits it: a cut that
          // moved on is shown and asked about again on its new revision.
          if (failure instanceof TimelineConflictError && !conflictRetried) {
            conflictRetried = true;
            options.adoptTimeline(failure.current);
            return submit();
          }
          if (failure instanceof HostRequestError && failure.code === 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED' && !consentRetried) {
            consentRetried = true;
            const listed = Array.isArray(failure.extra.modelIds) ? failure.extra.modelIds.filter((id): id is string => typeof id === 'string') : [];
            for (const modelId of listed.length > 0 ? listed : CAPTION_MODELS) await options.ensureModelConsent(modelId);
            return submit();
          }
          throw failure;
        }
      };
      let started: TranscriptionStarted;
      try {
        started = await submit();
      } catch (failure) {
        if (isAbort(failure)) throw failure;
        throw refusal(failure);
      }
      refresh();
      return { segments: [], text: '', backgroundTaskId: started.taskId };
    } finally {
      submitting = false;
    }
  };

  void load();

  return {
    transcribeTimeline,
    refresh,
    openReview,
    panel,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      loading?.abort();
      review?.close();
      review = null;
      panel.remove();
    },
  };
}

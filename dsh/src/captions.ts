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
 * Two engines can recognize: Whisper on this machine (free; the plugin runs
 * it in a hidden page of a DSH window, after the person agreed to download
 * its models) and the VibeDev gateway (paid per minute, Mandarin only, the
 * audio leaves the machine). The person chooses each time; there is never a
 * silent switch from one to the other.
 */

import type { VideoEditorCapabilityRuntime } from '../../packages/video-editor-bridge/src/host-contract.ts';
import { HostRequestError, TimelineConflictError } from './api.ts';
import type {
  CaptionDraft,
  CaptionEngineId,
  CaptionEngines,
  CaptionTaskSummary,
  CommandResult,
  TaskSnapshot,
  TimelineState,
  TranscribeBody,
  TranscriptionStarted,
} from './api.ts';
import { formatBytes } from './consent.ts';
import { codeOf, describeRefusal } from './refusals.ts';
import type { NoticeTone } from './session.ts';

/** The models local recognition needs, asked about in this order (Studio's). */
export const CAPTION_MODELS = ['whisper-small-q8', 'silero-vad'] as const;
/** The gateway's retail price. */
export const GATEWAY_YUAN_PER_MINUTE = 0.05;
/** What the person is told before audio leaves the machine. */
export const GATEWAY_NOTICE = '音频会上传到 VibeDev 网关转写（第三方 ASR），仅支持普通话；取消只能停止等待，已提交的转写仍会计费';

/** Where the person's last engine choice is remembered (this browser only; a convenience). */
const ENGINE_KEY = 'dsh-film:caption-engine';
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
  regionTiming: '按人声段计时，请试听',
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
  engineTitle: '识别原声字幕',
  engineLead: '选择识别方式。识别在后台进行，得到的是一份草稿，校对后才写入时间线。',
  whisper: '本机识别（免费）',
  gateway: 'VibeDev 网关转写（¥0.05/分钟）',
  start: '开始识别',
  startPaid: '确认计费并识别',
  noEngine: '现在没有能用的识别方式',
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

/** What the person is offered when they press CC. */
export interface EngineOffer {
  engines: CaptionEngines;
  /** The engine to preselect. */
  preferred: CaptionEngineId;
  /** At most this much audio would be recognized, when the page can tell. */
  seconds: number | null;
}

/** Ask the person which engine to use; null when they cancel. */
export type ChooseEngine = (offer: EngineOffer) => Promise<CaptionEngineId | null>;

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
  /** The saved cut, for the gateway's estimate. */
  timelineDocument(): unknown;
  notify(message: string, tone: NoticeTone): void;
  chooseEngine?: ChooseEngine;
  doc?: Document;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  activePollMs?: number;
  idlePollMs?: number;
}

type TranscribeTimeline = NonNullable<VideoEditorCapabilityRuntime['transcribeTimeline']>;
type TranscribeRequest = Parameters<TranscribeTimeline>[0];

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

/**
 * At most how many seconds of audio a request would send: its range, the
 * clip it names, or the whole visual track (the original sound of the
 * videos, which is what recognition takes by default). Null when the cut
 * says nothing usable.
 */
export function estimateSeconds(document: unknown, request: Pick<TranscribeRequest, 'clipId' | 'start' | 'duration'>): number | null {
  if (finite(request.start) && finite(request.duration) && request.duration > 0) return request.duration;
  const project = (document as { project?: Record<string, unknown> } | null)?.project;
  if (!project) return null;
  const clips = (key: string): Array<{ id?: unknown; duration?: unknown }> => (Array.isArray(project[key]) ? project[key] as Array<{ id?: unknown; duration?: unknown }> : []);
  if (request.clipId) {
    const clip = [...clips('visualSegments'), ...clips('audioSegments')].find(item => item.id === request.clipId);
    return clip && finite(clip.duration) && clip.duration > 0 ? clip.duration : null;
  }
  const total = clips('visualSegments').reduce((sum, clip) => sum + (finite(clip.duration) && clip.duration > 0 ? clip.duration : 0), 0);
  return total > 0 ? total : null;
}

/** The gateway's price for `seconds` of audio: minutes (one decimal, at least 0.1) and yuan. */
export function gatewayCost(seconds: number): { minutes: number; yuan: number } {
  const minutes = Math.max(0.1, Math.ceil((seconds / 60) * 10) / 10);
  return { minutes, yuan: Math.round(minutes * GATEWAY_YUAN_PER_MINUTE * 100) / 100 };
}

function engineNote(engine: CaptionEngines['engines'][number]): string {
  if (engine.id === 'whisper') {
    if (!engine.available) return engine.reason || (engine.runner === 'none' ? '需要一个打开着的 VibeDev 窗口' : '现在用不了');
    const granted = CAPTION_MODELS.every(id => engine.consent[id] === true);
    return granted
      ? 'Whisper，在这台电脑上识别，音频不离开本机'
      : `Whisper，在这台电脑上识别；第一次要下载识别模型（约 ${formatBytes(engine.downloadBytes)}）`;
  }
  if (!engine.available) return engine.reason || '需要 dsh-media 插件，并登录 VibeDev 账号';
  return `${engine.model ? `${engine.model}，` : ''}只支持普通话`;
}

/**
 * Build the engine question (exported for tests).
 * @param doc - the page's document.
 * @param offer - the engines and what to preselect.
 */
export function engineDialog(doc: Document, offer: EngineOffer): {
  root: HTMLElement;
  confirm: HTMLButtonElement;
  cancel: HTMLButtonElement;
  choices: Map<CaptionEngineId, HTMLInputElement>;
  cost: HTMLElement;
  selected(): CaptionEngineId | null;
} {
  const root = element(doc, 'div', { class: 'consent', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'caption-engine-title' });
  const card = element(doc, 'div', { class: 'consent-card' });
  root.append(card);
  card.append(element(doc, 'h2', { id: 'caption-engine-title' }, STRINGS.engineTitle));
  card.append(element(doc, 'p', { class: 'consent-lead' }, STRINGS.engineLead));

  const choices = new Map<CaptionEngineId, HTMLInputElement>();
  const list = element(doc, 'div', { class: 'caption-engines', role: 'radiogroup', 'aria-labelledby': 'caption-engine-title' });
  for (const engine of offer.engines.engines) {
    const label = element(doc, 'label', { class: 'caption-engine' });
    const input = element(doc, 'input', { type: 'radio', name: 'caption-engine', value: engine.id });
    input.disabled = !engine.available;
    const text = element(doc, 'span');
    text.append(element(doc, 'strong', {}, engine.id === 'whisper' ? STRINGS.whisper : STRINGS.gateway), element(doc, 'span', { class: 'consent-note' }, engineNote(engine)));
    label.append(input, text);
    list.append(label);
    choices.set(engine.id, input);
  }
  card.append(list);
  const initial = [offer.preferred, offer.engines.default, ...choices.keys()].find(id => choices.get(id)?.disabled === false);
  if (initial !== undefined) choices.get(initial)!.checked = true;

  // The price and the upload notice, shown while the gateway is chosen.
  const cost = element(doc, 'div', { class: 'caption-cost', role: 'note' });
  if (offer.seconds !== null) {
    const { minutes, yuan } = gatewayCost(offer.seconds);
    cost.append(element(doc, 'p', {}, `最多约 ${minutes} 分钟 × ¥${GATEWAY_YUAN_PER_MINUTE} ≈ ¥${yuan.toFixed(2)}（按实际送去转写的时长计费）`));
  } else {
    cost.append(element(doc, 'p', {}, `按实际送去转写的时长计费，每分钟 ¥${GATEWAY_YUAN_PER_MINUTE}`));
  }
  cost.append(element(doc, 'p', {}, GATEWAY_NOTICE));
  card.append(cost);

  const empty = element(doc, 'p', { class: 'consent-note', role: 'status' }, STRINGS.noEngine);
  card.append(empty);

  const actions = element(doc, 'div', { class: 'consent-actions' });
  const cancel = element(doc, 'button', { type: 'button', 'data-action': 'decline' }, STRINGS.cancel);
  const confirm = element(doc, 'button', { type: 'button', 'data-action': 'confirm', class: 'primary' }, STRINGS.start);
  actions.append(cancel, confirm);
  card.append(actions);

  const selected = (): CaptionEngineId | null => [...choices].find(([, input]) => input.checked && !input.disabled)?.[0] ?? null;
  const sync = (): void => {
    const engine = selected();
    cost.hidden = engine !== 'gateway';
    empty.hidden = engine !== null;
    confirm.disabled = engine === null;
    confirm.textContent = engine === 'gateway' ? STRINGS.startPaid : STRINGS.start;
  };
  for (const input of choices.values()) input.addEventListener('change', sync);
  sync();
  return { root, confirm, cancel, choices, cost, selected };
}

/**
 * The page's way of asking which engine: one dialog over the editor; Esc or
 * 取消 cancels.
 * @param doc - the page's document.
 */
export function createEnginePrompt(doc: Document = document): ChooseEngine {
  return offer => new Promise<CaptionEngineId | null>((resolve) => {
    const dialog = engineDialog(doc, offer);
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const close = (engine: CaptionEngineId | null): void => {
      doc.removeEventListener('keydown', onKey, true);
      dialog.root.remove();
      previous?.focus?.();
      resolve(engine);
    };
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      }
    }
    dialog.confirm.addEventListener('click', () => { close(dialog.selected()); });
    dialog.cancel.addEventListener('click', () => { close(null); });
    doc.addEventListener('keydown', onKey, true);
    doc.body.append(dialog.root);
    (dialog.confirm.disabled ? dialog.cancel : dialog.confirm).focus();
  });
}

/** What a line's warnings mean for the person. */
function warningLabel(warnings: readonly string[] | undefined): string | null {
  if (!warnings?.length) return null;
  return warnings.includes('region-timing') ? STRINGS.regionTiming : STRINGS.suspicious;
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
  const choose = options.chooseEngine ?? createEnginePrompt(doc);
  const activePoll = options.activePollMs ?? ACTIVE_POLL_MS;
  const idlePoll = options.idlePollMs ?? IDLE_POLL_MS;
  const storage = options.storage === undefined ? (() => { try { return globalThis.localStorage; } catch { return null; } })() : options.storage;

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

  const remembered = (): CaptionEngineId | null => {
    try {
      const value = storage?.getItem(ENGINE_KEY);
      return value === 'whisper' || value === 'gateway' ? value : null;
    } catch {
      return null;
    }
  };
  const remember = (engine: CaptionEngineId): void => {
    try { storage?.setItem(ENGINE_KEY, engine); } catch { /* a forgotten preference only preselects the default next time */ }
  };

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
        element(doc, 'span', { class: 'caption-task-engine' }, task.engine === 'gateway' ? '网关转写' : '本机识别'),
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
      const engine = await choose({ engines, preferred: remembered() ?? engines.default, seconds: estimateSeconds(options.timelineDocument(), request) });
      if (engine === null) throw abortError();
      remember(engine);
      const whisper = engines.engines.find(item => item.id === 'whisper');
      if (engine === 'whisper') {
        // Short and explicit: the plugin downloads and prepares the models itself.
        for (const modelId of CAPTION_MODELS) {
          if (whisper?.id === 'whisper' && whisper.consent[modelId] === true) continue;
          await options.ensureModelConsent(modelId);
        }
      }
      const language = engine === 'gateway' ? 'zh' : request.language;
      const body: Omit<TranscribeBody, 'baseRevision' | 'requestId'> = {
        engine,
        ...(language ? { language } : {}),
        ...(request.clipId ? { clipIds: [request.clipId] } : {}),
        ...(finite(request.start) && finite(request.duration) ? { range: { start: request.start, end: request.start + request.duration } } : {}),
        ...(engine === 'gateway' ? { spendingConfirmed: true } : {}),
      };
      const submit = async (retried: boolean): Promise<TranscriptionStarted> => {
        const baseRevision = await options.prepareTimeline();
        try {
          return await host.startTranscription({ ...body, baseRevision, requestId: crypto.randomUUID() });
        } catch (failure) {
          if (retried) throw failure;
          // Recognition reads the saved cut and never edits it: a cut that
          // moved on is shown and asked about again on its new revision.
          if (failure instanceof TimelineConflictError) {
            options.adoptTimeline(failure.current);
            return submit(true);
          }
          if (failure instanceof HostRequestError && failure.code === 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED') {
            const listed = Array.isArray(failure.extra.modelIds) ? failure.extra.modelIds.filter((id): id is string => typeof id === 'string') : [];
            for (const modelId of listed.length > 0 ? listed : CAPTION_MODELS) await options.ensureModelConsent(modelId);
            return submit(true);
          }
          throw failure;
        }
      };
      let started: TranscriptionStarted;
      try {
        started = await submit(false);
      } catch (failure) {
        if (isAbort(failure)) throw failure;
        throw refusal(failure);
      }
      const amount = started.estimate?.amountCny;
      if (engine === 'gateway' && finite(amount)) options.notify(`已提交网关转写，预计 ¥${amount.toFixed(2)}`, 'info');
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

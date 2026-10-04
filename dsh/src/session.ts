/**
 * One open cut: what the editor shows, and keeping it saved (Studio's
 * `CanvasTimelineEditor.tsx`, without React).
 *
 * Saves race by nature: the editor saves as the person edits, and an agent or
 * a placement can commit in the same moment. The plugin refuses a save built
 * on an overtaken revision and hands back the current cut; that cut is
 * adopted — the editor imports it and keeps the person's own edits through its
 * field gate, so its next autosave carries both — rather than retried as it
 * was, which would write over the other change unseen.
 *
 * 渲染到项目 is the plugin's own render (ffmpeg on this machine, Studio's
 * `startRender`): saves are drained first so the file is the cut on screen,
 * the render pins that revision, and progress and the outcome go through the
 * editor's toast, where its browser export reports too.
 */

import type {
  JsonObject,
  MountedVideoEditor,
  VideoEditorAuthorizedAsset,
  VideoEditorDocumentEnvelope,
  VideoEditorExportFile,
  VideoEditorHostEvent,
  VideoEditorProjectAspect,
  VideoEditorProjectFile,
  VideoEditorRenderCheck,
  VideoEditorRenderRequestSettings,
  VideoEditorVoiceOutcome,
} from '../../packages/video-editor-bridge/src/host-contract.ts';
import { HOST_PROJECT_ASPECTS } from '../../packages/video-editor-bridge/src/host-contract.ts';
import { createEmptyTimelineArchive } from '../../packages/video-editor-bridge/src/empty-archive.ts';
import { HostRequestError, TimelineConflictError } from './api.ts';
import type { PlacedClip, RenderBody, RenderCheck, RenderedFile, SoundPlaced, TaskSnapshot, TimelineState, UploadedFile } from './api.ts';
import { describeRefusal } from './refusals.ts';

/** What the session needs from the plugin. */
export interface SessionApi {
  getTimeline(): Promise<TimelineState>;
  saveTimeline(document: unknown, baseRevision: number): Promise<TimelineState>;
  undoTimeline(baseRevision: number): Promise<TimelineState>;
  redoTimeline(baseRevision: number): Promise<TimelineState>;
  getMaterial(): Promise<{ assets: VideoEditorAuthorizedAsset[]; projectFiles: VideoEditorProjectFile[] }>;
  uploadFile(path: string, blob: Blob, options: { unique?: boolean }): Promise<UploadedFile>;
  /** Put a film file on the storyboard; absent, exports stay off the board. */
  landOnBoard?(body: { path: string; title?: string; durationSeconds?: number }): Promise<{ landedNodeId: string | null }>;
  placeBoardMedia?(body: { source: { nodeId: string }; baseRevision: number; operationId: string; track?: 'music'; at?: number }): Promise<PlacedClip>;
  swapVersion?(body: { clipId: string; source: { nodeId: string } | { path: string }; baseRevision: number; operationId: string }): Promise<{ name: string }>;
  placeSound?(body: { script: { storyDocumentId: string } | { nodeId: string }; baseRevision: number; operationId: string }): Promise<{ items: SoundPlaced[]; warnings: string[] }>;
  /** The plugin's render; absent, 渲染到项目 does nothing. */
  renderTimeline?(body: RenderBody): Promise<{ taskId: string }>;
  checkRender?(body: RenderBody): Promise<RenderCheck>;
  waitTask?(taskId: string, since: number, timeoutMs: number): Promise<TaskSnapshot<RenderedFile>>;
}

/** The id prefix of a screenplay in the 剧本 menu; other ids are board text nodes. */
export const STORY_SCRIPT_PREFIX = 'story:';

/** How long to keep asking the editor to speak a caption it has not imported yet, or while it speaks another. */
const VOICE_ATTEMPTS = 25;
const VOICE_RETRY_MS = 400;

export type NoticeTone = 'info' | 'success' | 'error';

export interface SessionOptions {
  api: SessionApi;
  /** The board (the film project's id). */
  boardId: string;
  projectId: string;
  title: string;
  /** The film's aspect; one the editor cannot draw is left to the editor. */
  aspect?: string;
  /** A save failed or recovered (`null`). */
  onSaveError?(message: string | null): void;
  /** A line for the person, through the editor's toast. */
  notify?(message: string, tone: NoticeTone): void;
  /**
   * Ask for and download the renderer the plugin offers when it has no
   * ffmpeg (`FFMPEG_UNAVAILABLE` with `downloadable`); rejects with an
   * AbortError when the person declines.
   */
  obtainRenderer?(modelId: string): Promise<void>;
}

/** Where exported cuts are kept, relative to `film/`. */
export const RENDER_DIR = 'canvas/renders';

const RENDER_FRAME_RATES: readonly number[] = [24, 30, 60];
const RENDER_RESOLUTIONS: readonly string[] = ['720', '1080', '1440', '2160'];
/** Progress the editor's toast is worth interrupting for. */
const PROGRESS_MARKS = [25, 50, 75];
/** How long one long-poll step of a render may wait. */
const RENDER_WAIT_MS = 25_000;
/** How long to wait before asking again after a long-poll step failed; the render goes on meanwhile. */
const RENDER_WAIT_RETRY_MS = [1_000, 3_000, 9_000];

/** The render's percentage from its progress lines (`render N% · …`), or `fallback`. */
export function percentOf(progress: readonly string[], fallback: number): number {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    const match = /render (\d+)%/.exec(progress[index] ?? '');
    if (match) return Number(match[1]);
  }
  return fallback;
}

/** The export panel's default file name (Timeline Studio's `DEFAULT_EXPORT_SETTINGS.fileName`). */
const UPSTREAM_DEFAULT_FILE_NAME = 'ai-voiceover';

/**
 * The export panel's settings in the shapes the plugin takes. The panel offers
 * what the plugin renders, so anything else falls back to the defaults.
 */
export function renderRequestOf(settings: VideoEditorRenderRequestSettings): RenderBody {
  const frameRate = RENDER_FRAME_RATES.includes(settings.frameRate) ? settings.frameRate as 24 | 30 | 60 : 30;
  const resolution = RENDER_RESOLUTIONS.includes(settings.resolution) ? settings.resolution as '720' | '1080' | '1440' | '2160' : '720';
  const fileName = settings.fileName?.trim();
  // The upstream panel's default name says nothing about this film: without a name of their own the plugin names the file after the film.
  const chosen = fileName && fileName !== UPSTREAM_DEFAULT_FILE_NAME ? fileName : undefined;
  return { frameRate, resolution, ...(chosen ? { fileName: chosen } : {}) };
}

/** The renderer download a `FFMPEG_UNAVAILABLE` refusal offers, when it offers one. */
function offeredRenderer(error: unknown): string | null {
  if (!(error instanceof HostRequestError) || error.code !== 'FFMPEG_UNAVAILABLE') return null;
  const detail = error.extra.detail as { downloadable?: unknown; modelId?: unknown } | undefined;
  return detail?.downloadable === true && typeof detail.modelId === 'string' && detail.modelId !== '' ? detail.modelId : null;
}

const isAbort = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'AbortError';

const isAspect = (value: string | undefined): value is VideoEditorProjectAspect =>
  value !== undefined && (HOST_PROJECT_ASPECTS as readonly string[]).includes(value);

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The stem and extension of a name the editor would have downloaded. */
export function splitExportName(name: string): { base: string; extension: string } {
  const match = /^(.*)\.([A-Za-z0-9]+)$/.exec(name);
  const base = (match ? match[1]! : name).replace(/[<>:"/\\|?*#%\u0000-\u001f]+/g, '-').trim() || 'cut';
  return { base, extension: match ? match[2]!.toLowerCase() : 'bin' };
}

export class TimelineSession {
  revision = 0;
  document: unknown = null;
  assets: VideoEditorAuthorizedAsset[] = [];
  projectFiles: VideoEditorProjectFile[] = [];

  private editor: MountedVideoEditor | null = null;
  private pending: JsonObject | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private editEpoch = 0;
  private history: Promise<void> = Promise.resolve();
  private historyMoving = false;
  private externalPending = false;
  private externalTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private rendering = false;

  constructor(private readonly options: SessionOptions) {}

  /** The document the editor is given: the saved cut, or an empty one. */
  envelope(): VideoEditorDocumentEnvelope {
    const aspect = isAspect(this.options.aspect) ? this.options.aspect : undefined;
    return {
      schemaVersion: 1,
      projectId: this.options.projectId,
      // The editor keys its session on these and does not interpret them; a
      // board has neither a production nor a composite, so it is both.
      productionId: this.options.boardId,
      compositeId: this.options.boardId,
      projectTitle: this.options.title,
      ...(aspect ? { projectAspect: aspect } : {}),
      revision: this.revision,
      documentVersionId: `canvas:${this.options.boardId}:${this.revision}`,
      upstreamDocument: (this.document as JsonObject | null) ?? createEmptyTimelineArchive(aspect),
      assets: [...this.assets],
      ...(this.projectFiles.length > 0 ? { projectFiles: [...this.projectFiles] } : {}),
    };
  }

  /** Read the cut and the material before the editor mounts. */
  async load(): Promise<void> {
    const [state] = await Promise.all([this.options.api.getTimeline(), this.refreshMaterial(false)]);
    this.document = state.document;
    this.revision = state.revision;
  }

  attach(editor: MountedVideoEditor): void {
    this.editor = editor;
  }

  /** Whether an edit is not saved yet. */
  get busy(): boolean {
    return this.historyMoving || this.saving !== null || this.pending !== null || this.dirty;
  }

  private publish(): void {
    if (!this.disposed) this.editor?.updateDocument(this.envelope());
  }

  private applyState(state: TimelineState): void {
    this.document = state.document;
    this.revision = state.revision;
    this.publish();
  }

  /** Re-read the film's material (after a file was added somewhere). */
  async refreshMaterial(publish = true): Promise<void> {
    try {
      const material = await this.options.api.getMaterial();
      this.assets = material.assets;
      this.projectFiles = material.projectFiles;
    } catch {
      // An unreadable listing is a smaller library, not a broken desk: the cut
      // still opens and plays what it already has.
      return;
    }
    if (publish) this.publish();
  }

  /** The editor's events. History handlers return a promise the editor waits for. */
  handleEvent(event: VideoEditorHostEvent): void | Promise<void> {
    switch (event.type) {
      case 'dirty':
        this.editEpoch += 1;
        this.dirty = true;
        return undefined;
      case 'save-request':
        this.pending = event.upstreamDocument;
        void this.drainSaves().catch(() => undefined);
        return undefined;
      case 'history-request':
        return this.moveHistory(event.direction);
      case 'error':
        this.options.onSaveError?.(event.message);
        return undefined;
      case 'render-request':
        void this.startRender(event.settings);
        return undefined;
      default:
        return undefined;
    }
  }

  /** Save everything pending, one save at a time; every caller waits for the same flight. */
  drainSaves(): Promise<void> {
    if (this.saving) return this.saving;
    const work = (async () => {
      await this.editor?.flushChanges?.();
      for (;;) {
        const next = this.pending;
        if (next === null) return;
        this.pending = null;
        const epoch = this.editEpoch;
        try {
          const state = await this.options.api.saveTimeline(next, this.revision);
          this.revision = state.revision;
          await this.editor?.flushChanges?.();
          // An older acknowledgement must not import over a newer edit.
          if (this.editEpoch === epoch) {
            this.applyState(state);
            this.dirty = false;
          }
          this.options.onSaveError?.(null);
        } catch (error) {
          if (error instanceof TimelineConflictError) {
            // Adopt the current cut; the editor merges the person's edit into
            // it and saves again on the new revision.
            this.dirty = false;
            this.applyState(error.current);
            this.options.onSaveError?.(null);
            continue;
          }
          // Keep the draft: a failed save must never pass for a saved one.
          this.pending ??= next;
          throw error;
        }
      }
    })();
    let saved = false;
    const flight = work
      .then(() => { saved = true; })
      .catch((error: unknown) => {
        this.options.onSaveError?.(`保存失败：${message(error)}`);
        throw error;
      })
      .finally(() => {
        this.saving = null;
        // An edit that arrived as the loop was ending gets its own flight; a
        // failed flight waits for the next edit instead of retrying at once.
        if (saved && this.pending !== null && !this.disposed) void this.drainSaves().catch(() => undefined);
        else if (this.externalPending) this.requestExternalRefresh();
      });
    this.saving = flight;
    return flight;
  }

  /** Undo or redo on the saved cut, after pending saves; the editor waits for the import. */
  moveHistory(direction: 'undo' | 'redo'): Promise<void> {
    const work = this.history.catch(() => undefined).then(async () => {
      this.historyMoving = true;
      try {
        await this.drainSaves();
        const state = await (direction === 'undo' ? this.options.api.undoTimeline(this.revision) : this.options.api.redoTimeline(this.revision));
        this.applyState(state);
        await this.editor?.whenIdle?.();
        this.options.onSaveError?.(null);
      } catch (error) {
        if (error instanceof TimelineConflictError && !this.dirty) this.applyState(error.current);
        this.options.onSaveError?.(`${direction === 'undo' ? '撤销' : '重做'}失败：${message(error)}`);
      } finally {
        this.historyMoving = false;
        if (this.externalPending) this.requestExternalRefresh();
      }
    });
    this.history = work;
    return work;
  }

  /** The revision the cut is at once everything pending is saved; throws while an edit is unsaved. */
  async prepareTimeline(): Promise<number> {
    await this.drainSaves();
    if (this.busy) throw new Error('剪辑还没保存完，请稍后再试');
    return this.revision;
  }

  /** Show the cut the plugin says is current (a conflict's answer). */
  adopt(state: TimelineState): void {
    this.applyState(state);
  }

  /** Re-read the cut after the plugin committed a change of its own (a placement). */
  async reloadTimeline(): Promise<void> {
    if (this.busy) {
      this.externalPending = true;
      return;
    }
    this.applyState(await this.options.api.getTimeline());
  }

  /**
   * Something changed the film on disk (an agent, another window): re-read
   * the cut and the material when no edit is in flight, adopting the cut only
   * when it is newer than what the editor holds.
   */
  requestExternalRefresh(): void {
    this.externalPending = true;
    if (this.busy || this.disposed) return;
    clearTimeout(this.externalTimer);
    this.externalTimer = setTimeout(() => {
      if (this.busy || this.disposed) return;
      this.externalPending = false;
      void Promise.all([this.options.api.getTimeline(), this.refreshMaterial(false)]).then(([state]) => {
        if (this.disposed) return;
        if (this.busy) {
          this.externalPending = true;
          return;
        }
        if (state.revision > this.revision) {
          this.applyState(state);
        } else {
          this.publish();
        }
      }).catch((error: unknown) => { this.options.onSaveError?.(`刷新失败：${message(error)}`); });
    }, 120);
  }

  /**
   * The editor's own export, kept in the film instead of the download folder:
   * `film/canvas/renders/<name>`, the first free `-N` when the name is taken,
   * captions beside their video under its stem.
   * @returns whether the files were kept; false makes the editor download them.
   */
  async keepExport(files: VideoEditorExportFile[], notify: (text: string, tone: NoticeTone) => void): Promise<boolean> {
    const video = files.find(file => file.kind === 'video') ?? files[0];
    if (video === undefined) return false;
    try {
      const { base, extension } = splitExportName(video.name);
      const kept = await this.options.api.uploadFile(`${RENDER_DIR}/${base}.${extension}`, video.blob, { unique: true });
      const stem = kept.name.slice(kept.name.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
      for (const file of files) {
        if (file === video) continue;
        await this.options.api.uploadFile(`${RENDER_DIR}/${stem}.${splitExportName(file.name).extension}`, file.blob, {});
      }
      // Beside the material it was made from: on the storyboard, when there is one.
      const landing = this.options.api.landOnBoard
        ? await this.options.api.landOnBoard({
          path: kept.name,
          title: stem,
          ...(video.durationSeconds !== undefined ? { durationSeconds: video.durationSeconds } : {}),
        }).catch(() => undefined)
        : undefined;
      notify(
        landing?.landedNodeId
          ? `已存到 film/${kept.name}，并放上了分镜画布`
          : landing
            ? `已存到 film/${kept.name}；分镜画布还没有内容，所以没放上去`
            : `已保存到 film/${kept.name}`,
        'success',
      );
      void this.refreshMaterial();
      return true;
    } catch (error) {
      notify(`保存到项目失败，改为下载：${message(error)}`, 'error');
      return false;
    }
  }

  /**
   * Put one of the storyboard's media nodes on the cut: video and images after
   * the visual clips, audio on the music track at the playhead.
   */
  async placeBoardMedia(nodeId: string, track: 'default' | 'music', notify: (text: string, tone: NoticeTone) => void): Promise<void> {
    const place = this.options.api.placeBoardMedia;
    if (!place) return;
    try {
      await this.drainSaves();
      const at = this.editor?.playheadSeconds?.() ?? 0;
      const placed = await place({
        source: { nodeId },
        baseRevision: this.revision,
        operationId: `console-place-${Date.now().toString(36)}`,
        ...(track === 'music' ? { track: 'music' as const, ...(at > 0 ? { at } : {}) } : {}),
      });
      this.applyState(await this.options.api.getTimeline());
      notify(`已把 ${placed.name} 放在 ${placed.start.toFixed(1)} 秒处`, 'success');
    } catch (error) {
      if (error instanceof TimelineConflictError) this.applyState(error.current);
      notify(`没有放进去：${message(error)}`, 'error');
      throw error;
    }
  }

  /**
   * Give the selected clip another take from the storyboard: same place, same
   * length. The menu hands back a board node id, or a path for a take that has
   * left the board; a path always has a separator, an id never does.
   */
  async useVersion(clipId: string, versionId: string, notify: (text: string, tone: NoticeTone) => void): Promise<void> {
    const swap = this.options.api.swapVersion;
    if (!swap) return;
    try {
      await this.drainSaves();
      const swapped = await swap({
        clipId,
        source: versionId.includes('/') ? { path: versionId } : { nodeId: versionId },
        baseRevision: this.revision,
        operationId: `console-version-${Date.now().toString(36)}`,
      });
      this.applyState(await this.options.api.getTimeline());
      notify(`${swapped.name} 已换成你选的那条`, 'success');
    } catch (error) {
      if (error instanceof TimelineConflictError) this.applyState(error.current);
      notify(`没有换成：${message(error)}`, 'error');
      throw error;
    }
  }

  /**
   * Put a script on the cut's shots, one caption per line, and in `voice`
   * mode have the editor speak each caption: it puts the audio where the
   * caption is, which is where the shot is.
   */
  async placeScript(scriptId: string, mode: 'captions' | 'voice', notify: (text: string, tone: NoticeTone) => void): Promise<void> {
    const place = this.options.api.placeSound;
    if (!place) return;
    try {
      await this.drainSaves();
      const placed = await place({
        script: scriptId.startsWith(STORY_SCRIPT_PREFIX) ? { storyDocumentId: scriptId.slice(STORY_SCRIPT_PREFIX.length) } : { nodeId: scriptId },
        baseRevision: this.revision,
        operationId: `console-script-${Date.now().toString(36)}`,
      });
      this.applyState(await this.options.api.getTimeline());
      const captionIds = placed.items.flatMap(item => (item.captionId ? [item.captionId] : []));
      notify(`放上了 ${captionIds.length} 条字幕`, mode === 'voice' ? 'info' : 'success');
      for (const warning of placed.warnings) notify(warning, 'info');
      if (mode !== 'voice' || captionIds.length === 0) return;
      let spoken = 0;
      for (const [index, captionId] of captionIds.entries()) {
        notify(`正在配音 ${index + 1}/${captionIds.length}`, 'info');
        const outcome = await this.speak(captionId);
        if (this.disposed) return;
        if (outcome.status === 'done') {
          spoken += 1;
          continue;
        }
        notify(`这一条没配上音：${outcome.message || (outcome.status === 'busy' ? '编辑器一直在忙' : '编辑器里找不到这条字幕')}`, 'error');
        // A failed line is the engine's answer for that line; anything else will not get better by going on.
        if (outcome.status !== 'failed') break;
      }
      notify(`配好了 ${spoken}/${captionIds.length} 条`, spoken === captionIds.length ? 'success' : 'error');
    } catch (error) {
      if (error instanceof TimelineConflictError) this.applyState(error.current);
      notify(`没有放进去：${message(error)}`, 'error');
      throw error;
    }
  }

  /** Ask the editor to speak a caption, again while it has not imported it yet or is speaking another. */
  private async speak(captionId: string): Promise<VideoEditorVoiceOutcome> {
    for (let attempt = 0; attempt < VOICE_ATTEMPTS; attempt += 1) {
      const editor = this.editor;
      if (!editor?.generateVoiceover) return { status: 'missing' };
      const outcome = await editor.generateVoiceover(captionId);
      if (outcome.status !== 'missing' && outcome.status !== 'busy') return outcome;
      await new Promise(resolve => setTimeout(resolve, VOICE_RETRY_MS));
    }
    return { status: 'busy' };
  }

  /**
   * 渲染到项目: drain saves, have the plugin render the revision on screen,
   * follow the task with a toast per quarter, and say where the file went.
   * A cut that moved on is adopted and reported, not rendered unseen; a
   * missing ffmpeg the plugin can download is asked about once, then the
   * render is asked for again; a render already running is followed.
   */
  async startRender(settings: VideoEditorRenderRequestSettings): Promise<void> {
    const { renderTimeline, waitTask } = this.options.api;
    if (!renderTimeline || !waitTask) return;
    const say = (text: string, tone: NoticeTone = 'info'): void => {
      if (!this.disposed) this.options.notify?.(text, tone);
    };
    if (this.rendering) {
      say('已经在渲染了，等这一次完成');
      return;
    }
    this.rendering = true;
    try {
      say('正在提交渲染…');
      const body = renderRequestOf(settings);
      let taskId: string | undefined;
      let offered = false;
      while (taskId === undefined) {
        await this.drainSaves();
        try {
          taskId = (await renderTimeline({ ...body, baseRevision: this.revision })).taskId;
        } catch (error) {
          const modelId = offeredRenderer(error);
          if (modelId !== null && !offered && this.options.obtainRenderer) {
            offered = true;
            say('本机没有 ffmpeg，先下载渲染程序');
            await this.options.obtainRenderer(modelId);
            say('渲染程序已就绪，正在提交渲染…');
            continue;
          }
          const busy = error instanceof HostRequestError && error.code === 'RENDER_BUSY' ? error.extra.taskId : undefined;
          if (typeof busy !== 'string' || busy === '') throw error;
          say('已经有一次渲染在进行，接着报告它的进度');
          taskId = busy;
        }
      }
      let since = 0;
      let percent = 0;
      let failedWaits = 0;
      const announced = new Set<number>();
      for (;;) {
        let snapshot: TaskSnapshot<RenderedFile>;
        try {
          snapshot = await waitTask(taskId, since, RENDER_WAIT_MS);
          failedWaits = 0;
        } catch (error) {
          // A task the plugin does not know is an answer; anything else is
          // this page losing sight of a render that goes on without it.
          if (error instanceof HostRequestError && error.status === 404) throw error;
          if (this.disposed) return;
          const delay = RENDER_WAIT_RETRY_MS[failedWaits];
          failedWaits += 1;
          if (delay === undefined) {
            say(`暂时看不到渲染进度了，但渲染仍在后台进行；完成后文件会存入 film/${RENDER_DIR}/ 并出现在分镜画布上`);
            return;
          }
          await new Promise(resolve => setTimeout(resolve, delay));
          if (this.disposed) return;
          continue;
        }
        if (this.disposed) return;
        since = snapshot.nextSince;
        percent = percentOf(snapshot.progress, percent);
        if (snapshot.status === 'done' && snapshot.file) {
          const file = snapshot.file;
          say(`已存入 film/${file.name}${file.landedNodeId ? '，并放到了分镜画布上' : ''}`, 'success');
          void this.refreshMaterial();
          return;
        }
        if (snapshot.status === 'failed' || snapshot.status === 'interrupted') {
          say(`渲染失败：${snapshot.error ? describeRefusal(snapshot.error) : snapshot.status}`, 'error');
          return;
        }
        // One toast per quarter, not one per poll: the editor's toast is
        // short-lived, and a stream of them would hide the export's own.
        const mark = PROGRESS_MARKS.filter(value => percent >= value && !announced.has(value)).pop();
        if (mark !== undefined) {
          for (const value of PROGRESS_MARKS) if (value <= mark) announced.add(value);
          say(`渲染中 ${percent}%`);
        }
      }
    } catch (error) {
      if (error instanceof TimelineConflictError) this.applyState(error.current);
      if (isAbort(error)) say('没有下载渲染程序，这次没有渲染');
      else say(`渲染失败：${describeRefusal(error)}`, 'error');
    } finally {
      this.rendering = false;
    }
  }

  /**
   * Asked when the export panel opens: the plugin's own refusals against the
   * cut as saved, so "cannot render" is written beside the button instead of
   * discovered after pressing it. A missing ffmpeg the plugin can download is
   * not a refusal: pressing the button offers the download.
   */
  async checkRender(settings: VideoEditorRenderRequestSettings): Promise<VideoEditorRenderCheck> {
    const check = this.options.api.checkRender;
    if (!check) return { ok: true, reasons: [] };
    try {
      await this.drainSaves();
      await check({ ...renderRequestOf(settings), baseRevision: this.revision });
      return { ok: true, reasons: [] };
    } catch (error) {
      if (error instanceof TimelineConflictError) {
        this.applyState(error.current);
        return { ok: true, reasons: [] };
      }
      if (offeredRenderer(error) !== null && this.options.obtainRenderer) return { ok: true, reasons: [] };
      return { ok: false, reasons: [describeRefusal(error)] };
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.externalTimer);
    this.editor = null;
  }
}

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
} from '../../packages/video-editor-bridge/src/host-contract.ts';
import { HOST_PROJECT_ASPECTS } from '../../packages/video-editor-bridge/src/host-contract.ts';
import { createEmptyTimelineArchive } from '../../packages/video-editor-bridge/src/empty-archive.ts';
import { TimelineConflictError } from './api.ts';
import type { TimelineState, UploadedFile } from './api.ts';

/** What the session needs from the plugin. */
export interface SessionApi {
  getTimeline(): Promise<TimelineState>;
  saveTimeline(document: unknown, baseRevision: number): Promise<TimelineState>;
  undoTimeline(baseRevision: number): Promise<TimelineState>;
  redoTimeline(baseRevision: number): Promise<TimelineState>;
  getMaterial(): Promise<{ assets: VideoEditorAuthorizedAsset[]; projectFiles: VideoEditorProjectFile[] }>;
  uploadFile(path: string, blob: Blob, options: { unique?: boolean }): Promise<UploadedFile>;
}

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
}

/** Where exported cuts are kept, relative to `film/`. */
export const RENDER_DIR = 'canvas/renders';

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
      notify(`已保存到 film/${kept.name}`, 'success');
      void this.refreshMaterial();
      return true;
    } catch (error) {
      notify(`保存到项目失败，改为下载：${message(error)}`, 'error');
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.externalTimer);
    this.editor = null;
  }
}

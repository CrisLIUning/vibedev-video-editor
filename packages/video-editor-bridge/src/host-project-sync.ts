import type {
  JsonObject,
  VideoEditorProjectFile,
  VideoEditorAuthorizedAsset,
  VideoEditorCapabilityRuntime,
  VideoEditorDocumentEnvelope,
  VideoEditorHostActions,
  VideoEditorHostEvent,
  VideoEditorHostNotice,
  VideoEditorSelectedClip,
  VideoEditorVoiceOutcome,
  VideoEditorProjectAspect,
  VideoEditorRenderRequestSettings,
} from './host-contract.js';
import { HOST_PROJECT_ASPECTS } from './host-contract.js';

export interface EditorProjectImportContext {
  hostDocument?: boolean;
  authorizedAssets: VideoEditorAuthorizedAsset[];
}

export interface EditorProjectImportApi {
  /** Resolves only after the imported React state has committed. */
  importProject(file: File, context: EditorProjectImportContext): void | Promise<void>;
  getProjectSnapshot?(): JsonObject;
  acceptProjectBaseline?(project: JsonObject): void;
  setDocumentBusy?(busy: boolean): void;
  updateAuthorizedAssets?(assets: VideoEditorAuthorizedAsset[]): void;
  updateProjectFiles?(files: VideoEditorProjectFile[]): void;
  updateProjectMetadata?(metadata: { title: string; aspect?: VideoEditorProjectAspect }): void;
  /** The editor's own toast, lent to the host. */
  notify?(notice: VideoEditorHostNotice): void;
  /** The editor's own voice, lent to the host: speak this caption and put the audio under it. */
  generateVoiceover?(captionId: string): Promise<VideoEditorVoiceOutcome>;
  /** Where the editor's playhead is, in seconds. */
  playheadSeconds?(): number;
  /** The clip the person has selected, when its material can be exchanged. */
  selectedClip?(): VideoEditorSelectedClip | null;
}

export interface EditorHostBridge {
  readonly capabilityRuntime?: VideoEditorCapabilityRuntime;
  /** What the host adds to the editor's surfaces; absent, the editor shows only its own. */
  readonly hostActions?: VideoEditorHostActions;
  connect(api: EditorProjectImportApi): () => void;
  updateDocument(document: VideoEditorDocumentEnvelope): void;
  onProjectSnapshot(project: JsonObject): void;
  requestHistoryMove(direction: 'undo' | 'redo'): Promise<void>;
  /** The export panel's "render into the project": the host renders the revision it holds. */
  requestRender(settings: VideoEditorRenderRequestSettings): void;
  /** Host → editor: show this through the editor's toast. */
  notifyEditor(notice: VideoEditorHostNotice): void;
  /** Host → editor: speak this caption; `missing` when no editor is connected. */
  generateVoiceover(captionId: string): Promise<VideoEditorVoiceOutcome>;
  /** Host → editor: where the playhead is, in seconds; 0 when no editor is connected. */
  playheadSeconds(): number;
  /** Host → editor: which clip is selected; null when none is, or no editor is connected. */
  selectedClip(): VideoEditorSelectedClip | null;
  whenIdle(): Promise<void>;
  /** Publish the current authored state without waiting for the autosave debounce. */
  flushChanges(): Promise<void>;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function projectJson(document: VideoEditorDocumentEnvelope): string {
  return stableJson(objectValue(document.upstreamDocument.project));
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

function assetsJson(document: VideoEditorDocumentEnvelope): string {
  return JSON.stringify(document.assets);
}

function importFile(document: VideoEditorDocumentEnvelope): File {
  const payload: JsonObject = {
    ...document.upstreamDocument,
    // useProjectFiles also supports this JSON transport. It restores the same
    // project state without requiring the bridge to create a zip merely to
    // cross the React boundary; explicit user exports remain .timeline zips.
    format: 'timeline-studio-project',
  };
  return new File(
    [JSON.stringify(payload)],
    `${document.compositeId}.timeline.json`,
    { type: 'application/json' },
  );
}

export function createEditorHostBridge(
  initialDocument: VideoEditorDocumentEnvelope,
  onEvent: (event: VideoEditorHostEvent) => void,
  capabilityRuntime?: VideoEditorCapabilityRuntime,
  hostActions?: VideoEditorHostActions,
): EditorHostBridge {
  let currentDocument = initialDocument;
  let expectedProjectJson = projectJson(initialDocument);
  // The renderer adds defaults/decodes media on import. That projection is
  // not a user edit and must never truncate the daemon's redo branch.
  let editorProjectJson = expectedProjectJson;
  let expectedAssetsJson = assetsJson(initialDocument);
  let expectedProjectFilesJson = JSON.stringify(initialDocument.projectFiles ?? []);
  let expectedProjectTitle = initialDocument.projectTitle;
  let expectedProjectAspect = initialDocument.projectAspect;
  // What the editor has actually been told. `connect` runs again every time the
  // editor re-subscribes — which it does whenever its own ratio changes — so
  // replaying the aspect there is what made the ratio control unusable.
  let publishedAspect: string | null = null;
  let api: EditorProjectImportApi | null = null;
  let ready = false;
  let connected = false;
  let idle: Promise<void> = Promise.resolve();
  let importGeneration = 0;
  let history: Promise<void> = Promise.resolve();
  let movingHistory = false;

  /**
   * The aspect to hand the editor now, or nothing.
   *
   * The host is authoritative when it CHANGES the ratio, not permanently.
   * Between host changes the editor owns it, which is what makes the ratio
   * control usable at all.
   */
  const takeAspectToPublish = (): VideoEditorDocumentEnvelope['projectAspect'] => {
    const aspect = currentDocument.projectAspect;
    if (!shouldAdoptHostAspect({
      hostAspect: aspect,
      lastAdopted: publishedAspect,
      current: undefined,
      allowed: HOST_PROJECT_ASPECTS,
    })) return undefined;
    publishedAspect = aspect ?? null;
    return aspect;
  };

  const enqueueImport = (document: VideoEditorDocumentEnvelope, emitReady: boolean) => {
    const target = api;
    if (!target) return;
    const generation = ++importGeneration;
    ready = false;
    target.setDocumentBusy?.(true);
    expectedProjectJson = projectJson(document);
    idle = idle
      .catch(() => undefined)
      .then(async () => {
        if (api !== target || generation !== importGeneration) return;
        await target.importProject(importFile(document), {
          hostDocument: true,
          authorizedAssets: document.assets.map((asset) => ({ ...asset })),
        });
        if (api !== target || generation !== importGeneration) return;
        editorProjectJson = target.getProjectSnapshot
          ? stableJson(target.getProjectSnapshot()) : projectJson(document);
        ready = true;
        target.setDocumentBusy?.(movingHistory);
        if (emitReady) onEvent({ type: 'ready', revision: document.revision });
      })
      .catch((reason: unknown) => {
        if (api !== target || generation !== importGeneration) return;
        ready = false;
        onEvent({
          type: 'error',
          code: 'EDITOR_DOCUMENT_IMPORT_FAILED',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
  };

  const bridge: EditorHostBridge = {
    ...(capabilityRuntime ? { capabilityRuntime } : {}),
    ...(hostActions ? { hostActions } : {}),
    connect(nextApi) {
      api = nextApi;
      connected = true;
      nextApi.updateAuthorizedAssets?.(currentDocument.assets.map((asset) => ({ ...asset })));
      nextApi.updateProjectFiles?.((currentDocument.projectFiles ?? []).map((file) => ({ ...file })));
      const aspect = takeAspectToPublish();
      nextApi.updateProjectMetadata?.({
        title: currentDocument.projectTitle || '',
        ...(aspect ? { aspect } : {}),
      });
      enqueueImport(currentDocument, true);
      return () => {
        if (api !== nextApi) return;
        api = null;
        ready = false;
        connected = false;
      };
    },
    updateDocument(document) {
      const changedProject = projectJson(document) !== expectedProjectJson;
      const changedAssets = assetsJson(document) !== expectedAssetsJson;
      const nextProjectFilesJson = JSON.stringify(document.projectFiles ?? []);
      const changedProjectFiles = nextProjectFilesJson !== expectedProjectFilesJson;
      const changedProjectTitle = document.projectTitle !== expectedProjectTitle;
      // The metadata channel used to fire on a title change alone. Aspect is
      // edited in BriefInspector without touching the title, so a change there
      // never left the host: the canvas and the export stayed on the old ratio
      // until the editor was reloaded.
      const changedProjectAspect = document.projectAspect !== expectedProjectAspect;
      currentDocument = document;
      if (changedProjectTitle || changedProjectAspect) {
        expectedProjectTitle = document.projectTitle;
        expectedProjectAspect = document.projectAspect;
        // A title-only change must not carry the aspect along: that would
        // re-assert the production's ratio over whatever the user just picked.
        const aspect = takeAspectToPublish();
        api?.updateProjectMetadata?.({
          title: document.projectTitle || '',
          ...(aspect ? { aspect } : {}),
        });
      }
      if (changedAssets) {
        expectedAssetsJson = assetsJson(document);
        api?.updateAuthorizedAssets?.(document.assets.map((asset) => ({ ...asset })));
      }
      if (changedProjectFiles) {
        expectedProjectFilesJson = nextProjectFilesJson;
        api?.updateProjectFiles?.((document.projectFiles ?? []).map((file) => ({ ...file })));
      }
      if (connected && changedProject) enqueueImport(document, false);
      else if (ready) api?.acceptProjectBaseline?.(objectValue(document.upstreamDocument.project));
    },
    onProjectSnapshot(project) {
      if (!ready || movingHistory) return;
      const projectionJson = stableJson(project);
      if (projectionJson === editorProjectJson) return;
      // The editor's snapshot is built from the fields it models; a field the
      // daemon wrote and the editor does not know — the render's loudness
      // target, say — would be dropped by the next autosave and the agent's
      // write undone. Such fields ride through from the document the editor
      // was given; a field the editor models stays the editor's to change.
      const carried = objectValue(currentDocument.upstreamDocument.project);
      const merged: JsonObject = { ...project };
      for (const key of Object.keys(carried)) {
        const value = carried[key];
        if (!(key in merged) && value !== undefined) merged[key] = value;
      }
      project = merged;
      const nextProjectJson = stableJson(project);
      editorProjectJson = projectionJson;
      if (nextProjectJson === expectedProjectJson) return;
      expectedProjectJson = nextProjectJson;
      // Autosave echoes do not re-import. Advance the three-way reconcile
      // base here too, or undo back to the last imported value is skipped.
      api?.acceptProjectBaseline?.(project);
      currentDocument = {
        ...currentDocument,
        upstreamDocument: {
          ...currentDocument.upstreamDocument,
          project,
        },
      };
      onEvent({ type: 'dirty', baseRevision: currentDocument.revision });
      onEvent({
        type: 'save-request',
        baseRevision: currentDocument.revision,
        upstreamDocument: currentDocument.upstreamDocument,
      });
    },
    requestHistoryMove(direction) {
      const target = api;
      history = history.catch(() => undefined).then(async () => {
        await bridge.flushChanges();
        if (!target || api !== target || !ready) return;
        movingHistory = true;
        target.setDocumentBusy?.(true);
        try {
          await onEvent({ type: 'history-request', direction, baseRevision: currentDocument.revision });
          await idle;
        } finally { movingHistory = false; target.setDocumentBusy?.(!ready); }
      }).catch(reason => onEvent({ type: 'error', code: 'EDITOR_HISTORY_FAILED', message: reason instanceof Error ? reason.message : String(reason) }));
      return history;
    },
    requestRender(settings) {
      if (!ready) return;
      onEvent({
        type: 'render-request',
        baseRevision: currentDocument.revision,
        settings: { ...settings },
      });
    },
    notifyEditor(notice) {
      api?.notify?.(notice);
    },
    async generateVoiceover(captionId) {
      if (!api?.generateVoiceover) return { status: 'missing' };
      return api.generateVoiceover(captionId);
    },
    playheadSeconds() {
      const seconds = api?.playheadSeconds?.();
      return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    },
    selectedClip() {
      const selection = api?.selectedClip?.();
      return selection && typeof selection.clipId === 'string' && selection.clipId ? selection : null;
    },
    whenIdle() {
      return idle;
    },
    async flushChanges() {
      await idle;
      if (!ready) throw new Error('Editor document is not ready');
      const snapshot = api?.getProjectSnapshot?.();
      if (snapshot) bridge.onProjectSnapshot(snapshot);
    },
  };
  return bridge;
}

/** Ratios the host contract can publish; the list lives in host-contract.ts. */
export { HOST_PROJECT_ASPECTS };

/**
 * Whether the editor should take the host's aspect ratio as its own.
 *
 * The host publishes the production's authored ratio so a 9:16 production does
 * not silently export landscape. That makes the host authoritative *when it
 * changes* — not permanently. The difference is the whole bug: the editor
 * re-connects whenever its own ratio changes, `connect` replays the host's
 * metadata, and a rule of "adopt whenever it differs from mine" then reverts
 * the user's pick every single time they make one. Selecting a ratio became
 * impossible.
 *
 * So adoption is keyed on the host's value changing, and `lastAdopted` is what
 * remembers that. Between host changes the editor owns its ratio.
 */
export function shouldAdoptHostAspect(input: {
  /** Ratio the host just published, if any. */
  hostAspect: string | null | undefined;
  /** Host ratio this editor has already taken, if any. */
  lastAdopted: string | null | undefined;
  /** Ratio the editor is on right now. */
  current: string | null | undefined;
  /** Ratio ids this editor can actually render. */
  allowed: readonly string[];
}): boolean {
  const { hostAspect, lastAdopted, current, allowed } = input;
  if (!hostAspect) return false;
  if (!allowed.includes(hostAspect)) return false;
  // Already taken this host value: a reconnect must not undo what the user
  // chose afterwards.
  if (lastAdopted === hostAspect) return false;
  return hostAspect !== current;
}

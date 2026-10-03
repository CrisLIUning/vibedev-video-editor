export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type VideoEditorAssetKind = 'image' | 'video' | 'audio' | 'font';

export const VIDEO_EDITOR_CAPABILITIES = [
  'caption-font',
  'transcribe',
  'tts',
  'music',
  'repair',
  'restoration',
  'segmentation',
  'depth',
  'avatar',
  'face-swap',
  'auto-edit',
  'vocal-separation',
  'voice-conversion',
  'audio-extraction',
  'optical-flow',
] as const;

export type VideoEditorCapabilityId = (typeof VIDEO_EDITOR_CAPABILITIES)[number];

export function isVideoEditorCapabilityId(value: unknown): value is VideoEditorCapabilityId {
  return typeof value === 'string'
    && (VIDEO_EDITOR_CAPABILITIES as readonly string[]).includes(value);
}

export interface VideoEditorCapabilityRequest {
  schemaVersion: 1;
  requestId: string;
  capability: VideoEditorCapabilityId;
  title: string;
  outputKind?: Exclude<VideoEditorAssetKind, 'font'>;
  targetAssetId?: string;
  inputVersionIds?: string[];
  parameters?: JsonObject;
}

export interface VideoEditorCapabilityTask {
  taskId: string;
  signal: AbortSignal;
}

export interface VideoEditorCapabilityProgress {
  progress?: number;
  phase?: string;
}

export interface VideoEditorCapabilityPlacement {
  track: 'visuals' | 'audio' | 'music' | 'source';
  sourceOffsets?: Array<{ clipId: string; offset: number }>;
  linkedSourceAssetId?: string;
  muteOverlayClipId?: string;
  disableSourceClipId?: string;
  muteMusicClipId?: string;
  preserveOriginal?: boolean;
  restoreOriginal?: boolean;
  sourceStart?: number;
  sourceDuration?: number;
  playbackRate?: number;
  muted?: boolean;
  clipId?: string;
  start?: number;
  duration?: number;
  volume?: number;
  replace?: boolean;
  replaceClipId?: string;
  width?: number;
  height?: number;
}

export interface VideoEditorCapabilityOutput {
  blob?: Blob;
  fileName?: string;
  mimeType?: string;
  placement?: VideoEditorCapabilityPlacement;
  files?: Array<{
    blob: Blob;
    fileName?: string;
    mimeType?: string;
    title?: string;
    analysisRole?: string;
    placement?: VideoEditorCapabilityPlacement;
  }>;
  documentResult?: JsonObject;
  analysisResult?: VideoEditorAnalysisOutput;
}

export type VideoEditorAnalysisKind = 'subject' | 'object' | 'depth';

export interface VideoEditorAnalysisOutput {
  analysisId: string;
  analysisKind: VideoEditorAnalysisKind;
  source: {
    assetId: string;
    versionId: string;
    clipId: string;
    mediaType: 'image' | 'video';
    sourceStart: number;
    sourceDuration: number;
  };
  model: { id: string; revision: string };
  width: number;
  height: number;
  frameRate: number;
  temporalMapping: { start: number; duration: number; sampleCount: number };
  metadata?: JsonObject;
}

export interface VideoEditorCapabilityCompletion {
  taskId: string;
  asset?: VideoEditorAuthorizedAsset;
  assets?: VideoEditorAuthorizedAsset[];
  documentResult?: JsonObject;
}

export interface VideoEditorModelArtifactManifest {
  id: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

export interface VideoEditorModelManifest {
  schemaVersion: 1;
  id: string;
  label: string;
  capability: VideoEditorCapabilityId;
  revision: string;
  license: { name: string; notice?: string; url?: string };
  consent: 'download' | 'restricted';
  totalBytes: number;
  artifacts: VideoEditorModelArtifactManifest[];
}

export interface VideoEditorPreparedModel {
  modelId: string;
  revision: string;
  artifacts: Record<string, string>;
}

export interface VideoEditorModelPrepareRequest {
  modelId: string;
  signal?: AbortSignal;
  onProgress?: (update: { progress: number; phase: string }) => void;
}

export interface VideoEditorVisionDescribeRequest {
  language: string;
  frames: Array<{ blob: Blob; time: number }>;
  signal?: AbortSignal;
}

export interface VideoEditorSourceAssetPinRequest {
  localAssetId: string;
  kind: Exclude<VideoEditorAssetKind, 'font'>;
  name: string;
  blob: Blob;
}

export interface VideoEditorProjectFile {
  id: string;
  path: string;
  name: string;
  kind: Extract<VideoEditorAssetKind, 'image' | 'video' | 'audio'>;
  url: string;
  mimeType: string;
  sizeBytes?: number;
  mtime?: number;
}

export interface VideoEditorProjectFilePinRequest {
  localAssetId: string;
  projectFileId: string;
  path: string;
  kind: Extract<VideoEditorAssetKind, 'image' | 'video' | 'audio'>;
  name: string;
}

/** Host-owned execution seam. The upstream editor retains its browser workers,
 * while VibeDev owns durable task state, cancellation and AssetVersion upload. */
export interface VideoEditorCapabilityRuntime {
  /** Flush pending saves and pin the timeline revision before processing. */
  captureTimeline?(): Promise<number>;
  commitTimeline?(request: { operationId: string; baseRevision: number; operations: JsonObject[] }): Promise<void>;

  /** Host reads the saved cut. A backgroundTaskId acknowledges submission only; drafts are reviewed/applied separately through native commands. Older embedders may return applied segments synchronously. */
  transcribeTimeline?(request: {clipId?: string; track?: string; start?: number; duration?: number; language: string; onProgress(update: {progress:number;phase:string}):void}): Promise<{segments:Array<{id:string;text:string;start:number;end:number}>;text:string;backgroundTaskId?:string}>;
  /** Check/obtain download consent only; the host owns preparation afterwards. */
  ensureModelConsent?(modelId:string, signal?:AbortSignal):Promise<void>;
  /** Optional during phased rollout so older standalone embedders keep their
   * browser-local model source behavior until they adopt the host cache. */
  prepareModel?(request: VideoEditorModelPrepareRequest): Promise<VideoEditorPreparedModel>;
  checkVisionSupport?(): Promise<{ available: boolean; provider?: string; model?: string }>;
  describeFrames?(request: VideoEditorVisionDescribeRequest): Promise<{ captions: string[] }>;
  /** Persist an editor-local upload as an immutable host AssetVersion before
   * a durable analysis task records source lineage. Calls are idempotent for
   * one runtime and localAssetId, including concurrent callers. */
  pinSourceAsset?(request: VideoEditorSourceAssetPinRequest): Promise<VideoEditorAuthorizedAsset>;
  /** Copy a safe project-relative file into a durable AssetVersion on first use. */
  pinProjectFile?(request: VideoEditorProjectFilePinRequest): Promise<VideoEditorAuthorizedAsset>;
  start(request: VideoEditorCapabilityRequest): Promise<VideoEditorCapabilityTask>;
  progress(taskId: string, update: VideoEditorCapabilityProgress): Promise<void>;
  complete(
    taskId: string,
    request: VideoEditorCapabilityRequest,
    output: VideoEditorCapabilityOutput,
  ): Promise<VideoEditorCapabilityCompletion>;
  fail(taskId: string, error: { code?: string; message: string }): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

export interface VideoEditorAuthorizedAsset {
  assetId: string;
  versionId: string;
  kind: VideoEditorAssetKind;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes?: number;
  durationSeconds?: number;
  /**
   * True when this entry is an OLDER version of its asset. Every version stays
   * in this list because it is the authorization list: a timeline clip pinned
   * to an older version must still resolve against it. But the media library
   * shows one card per asset, so it does not add a card for a superseded
   * version. Field report 2026-09-03: a regenerated video appeared twice in
   * "my media", once as "VibeDev · 视频" (the version whose duration was never
   * measured) and once as "VibeDev · 8.4s" — two versions of one asset, two
   * cards. Absent means current, so an entry from a producer that does not set
   * this still shows.
   */
  supersededVersion?: boolean;
}

/** Serializable document boundary passed from the VibeDev host to the editor.
 * `upstreamDocument` is intentionally opaque so a newer upstream release can
 * round-trip fields that the bridge does not understand yet. */
/**
 * Ratios the host contract can publish — the vendored editor's own table
 * (`config/editor.js` RATIO_OPTIONS), including the two cinema frames the
 * fork adds. An id outside this list is ignored by the editor rather than
 * rendered wrong.
 */
export const HOST_PROJECT_ASPECTS = ['9:16', '16:9', '1:1', '4:5', '21:9', '2.39:1'] as const;
export type VideoEditorProjectAspect = (typeof HOST_PROJECT_ASPECTS)[number];

export interface VideoEditorDocumentEnvelope {
  schemaVersion: 1;
  projectId: string;
  productionId: string;
  projectTitle?: string;
  /** The production's authored aspect. The editor keeps its own `ratioId` for
   *  the canvas and the export, and until this field existed the two never
   *  spoke: a 9:16 production opened on the editor's default and exported at
   *  that default too. Values match `ProductionAspect` exactly, which is also
   *  the editor's own `RATIO_OPTIONS` id set. */
  projectAspect?: VideoEditorProjectAspect;
  compositeId: string;
  revision: number;
  documentVersionId: string;
  upstreamDocument: JsonObject;
  assets: VideoEditorAuthorizedAsset[];
  projectFiles?: VideoEditorProjectFile[];
}

export interface VideoEditorCommandRequest {
  schemaVersion: 1;
  operationId: string;
  baseRevision: number;
  command: JsonObject;
}

export type VideoEditorCommandResult =
  | {
      ok: true;
      operationId: string;
      revision: number;
      documentVersionId: string;
      diff: JsonObject;
    }
  | {
      ok: false;
      operationId: string;
      code: string;
      message: string;
      currentRevision?: number;
      details?: JsonObject;
    };

/**
 * What the editor's export panel hands the host when the person picks the
 * host's own render instead of the browser's: the settings the panel showed,
 * so the two paths never disagree about what was asked for.
 */
export interface VideoEditorRenderRequestSettings {
  fileName?: string;
  /** The short side, as the panel names it: '720' | '1080' | '1440' | '2160'. */
  resolution: string;
  frameRate: number;
}

/**
 * Actions the host adds to the editor's own surfaces. The editor renders
 * them where its equivalent lives — a render into the project sits beside
 * the browser export, in the export panel — and says nothing about what they
 * do; the host answers the event.
 */
/** Whether the host's render would take this cut, and why not when it would not. */
export interface VideoEditorRenderCheck {
  ok: boolean;
  reasons: string[];
}

/** A sequence video the host's board holds, as the file menu lists it. */
export interface VideoEditorHostShotSequence {
  id: string;
  title: string;
  durationSeconds: number;
  shotCount: number;
}

export interface VideoEditorHostActions {
  renderToProject?: {
    label: string;
    hint?: string;
    /**
     * Asked when the export panel opens, so a cut the host cannot render is
     * marked there — before anyone presses the button — instead of failing a
     * moment later.
     */
    check?: (settings: VideoEditorRenderRequestSettings) => Promise<VideoEditorRenderCheck>;
  };
  /**
   * The host's shot lists — the desk's sequence videos on the board — offered
   * in the file menu: one clip per shot, appended or replacing the visual
   * track. The host does the placing and reports through `notify`.
   */
  shotSequences?: {
    label: string;
    hint?: string;
    labels: { append: string; replace: string; empty: string; shots: string };
    list: () => Promise<VideoEditorHostShotSequence[]>;
    place: (sequenceId: string, mode: 'append' | 'replace') => Promise<void>;
  };
  /**
   * The host's scripts — text nodes on the board — offered in the file menu:
   * one caption per line on the cut's shots, and, in `voice` mode, the
   * editor's own voice spoken for each caption afterwards. The host does the
   * placing and reports through `notify`.
   */
  scripts?: {
    label: string;
    hint?: string;
    labels: { captions: string; voice: string; empty: string; lines: string };
    list: () => Promise<VideoEditorHostScript[]>;
    place: (scriptId: string, mode: 'captions' | 'voice') => Promise<void>;
  };
  /**
   * The board's own material — the media nodes on it — offered in the file
   * menu: put this one on the timeline. Video and images go on the visual
   * track, audio on the voice track at the playhead, or on the music track.
   * The host does the placing and reports through `notify`.
   */
  boardMedia?: {
    label: string;
    hint?: string;
    labels: { place: string; music: string; empty: string };
    list: () => Promise<VideoEditorHostBoardMedia[]>;
    place: (nodeId: string, track: 'default' | 'music') => Promise<void>;
  };
  /**
   * Where the editor's own export goes. Standalone it goes to the browser's
   * download folder; inside a host that is outside the product, so a host may
   * take the finished files instead and put them where the rest of the work
   * is. `keep` answers false when it could not, and the editor downloads them
   * after all rather than losing a render nobody can cheaply re-make.
   */
  keepExport?: {
    /** What the export panel says about where the file will go. */
    hint: string;
    keep: (files: VideoEditorExportFile[]) => Promise<boolean>;
  };
  /**
   * The takes that could fill the selected clip, offered in the file menu: a
   * shot is generated more than once, and the board holds the others. Choosing
   * one exchanges the material and leaves the slot alone — same place, same
   * length, same grade. Which clip is meant comes from the editor's own
   * selection, which is why `list` takes no argument.
   */
  versions?: {
    label: string;
    hint?: string;
    labels: { use: string; current: string; empty: string; none: string };
    list: () => Promise<VideoEditorHostVersions>;
    use: (versionId: string) => Promise<void>;
  };
}

/** One file the editor's export produced. */
export interface VideoEditorExportFile {
  blob: Blob;
  /** The name the editor would have downloaded it under. */
  name: string;
  kind: 'video' | 'audio' | 'captions';
  durationSeconds?: number;
}

/** The clip whose takes are being offered, as the file menu names it. */
export interface VideoEditorHostVersionSlot {
  clipId: string;
  title: string;
  durationSeconds: number;
}

/** One take that could fill the selected clip. */
export interface VideoEditorHostVersion {
  /** What `use` takes back: the board node, or the file when it has left the board. */
  id: string;
  title: string;
  kind: 'video' | 'image' | 'audio';
  durationSeconds?: number;
  /** True for the take the clip plays now. */
  current: boolean;
  /** Why this take cannot fill the clip, when it cannot; it is still shown. */
  refusal?: string;
}

export interface VideoEditorHostVersions {
  /** Null when nothing whose material can be exchanged is selected. */
  slot: VideoEditorHostVersionSlot | null;
  versions: VideoEditorHostVersion[];
}

/** A media node the host's board holds, as the file menu lists it. */
export interface VideoEditorHostBoardMedia {
  id: string;
  title: string;
  kind: 'video' | 'image' | 'audio';
  durationSeconds?: number;
}

/** A script the host holds, as the file menu lists it. */
export interface VideoEditorHostScript {
  id: string;
  title: string;
  lineCount: number;
  preview: string;
}

/**
 * What became of asking the editor to speak a caption: `done` when a voice
 * landed under it, `busy` while the editor is still speaking another,
 * `missing` when it has no such caption (yet), `failed` with the engine's
 * own words otherwise.
 */
export interface VideoEditorVoiceOutcome {
  status: 'done' | 'busy' | 'missing' | 'failed';
  message?: string;
}

/** A line the host wants the editor to show the way it shows its own. */
export interface VideoEditorHostNotice {
  message: string;
  tone?: 'info' | 'success' | 'error';
}

export type VideoEditorHostEvent =
  | { type: 'ready'; revision: number }
  | { type: 'dirty'; baseRevision: number }
  | { type: 'command-request'; request: VideoEditorCommandRequest }
  | { type: 'save-request'; baseRevision: number; upstreamDocument: JsonObject }
  | { type: 'history-request'; direction: 'undo' | 'redo'; baseRevision: number }
  | { type: 'render-request'; baseRevision: number; settings: VideoEditorRenderRequestSettings }
  | { type: 'error'; code: string; message: string };

export interface VideoEditorHostOptions {
  hostId: string;
  locale: string;
  theme: Record<string, string>;
  document: VideoEditorDocumentEnvelope;
  capabilityRuntime?: VideoEditorCapabilityRuntime;
  hostActions?: VideoEditorHostActions;
  libraryWorkspace?: {
    current(): Promise<string | null>;
    subscribe(changed: () => void): () => void;
  };
  /** History handlers may return a promise; restoration waits for it. */
  onEvent(event: VideoEditorHostEvent): void;
}

export interface MountedVideoEditor {
  updateDocument(document: VideoEditorDocumentEnvelope): void;
  resolveCommand(result: VideoEditorCommandResult): void;
  /** Show a notice through the editor's own toast; a no-op before the editor has one. */
  notify?(notice: VideoEditorHostNotice): void;
  /** Speak a caption with the editor's selected voice and put the audio under it; `missing` before the editor is up. */
  generateVoiceover?(captionId: string): Promise<VideoEditorVoiceOutcome>;
  /** Where the editor's playhead is, in seconds; 0 before the editor is up. */
  playheadSeconds?(): number;
  /** The clip the person has selected, when it is one whose material can be exchanged. */
  selectedClip?(): VideoEditorSelectedClip | null;
  flushChanges?(): Promise<void>;
  whenIdle?(): Promise<void>;
  unmount(): void;
}

/** What the editor says is selected: a clip id and which track it sits on. */
export interface VideoEditorSelectedClip {
  clipId: string;
  track: 'visuals' | 'audio' | 'music' | 'source';
  sourceOffsets?: Array<{ clipId: string; offset: number }>;
  linkedSourceAssetId?: string;
  muteOverlayClipId?: string;
  disableSourceClipId?: string;
  muteMusicClipId?: string;
  preserveOriginal?: boolean;
  restoreOriginal?: boolean;
  sourceStart?: number;
  sourceDuration?: number;
  playbackRate?: number;
  muted?: boolean;
}

export type VideoEditorMountImplementation = (
  container: HTMLElement,
  options: VideoEditorHostOptions,
) => Pick<MountedVideoEditor, 'unmount'> & Partial<Omit<MountedVideoEditor, 'unmount'>>;

export type VideoEditorHostErrorCode =
  | 'EDITOR_ALREADY_MOUNTED'
  | 'EDITOR_BUNDLE_INVALID'
  | 'EDITOR_COMMAND_SCHEMA_UNSUPPORTED'
  | 'EDITOR_OPERATION_ID_REQUIRED'
  | 'EDITOR_REVISION_CONFLICT'
  | 'EDITOR_COMMAND_INVALID';

export class VideoEditorHostError extends Error {
  readonly code: VideoEditorHostErrorCode;
  readonly details?: JsonObject;

  constructor(code: VideoEditorHostErrorCode, message: string, details?: JsonObject) {
    super(message);
    this.name = 'VideoEditorHostError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the concurrency fields before a command reaches either the UI or
 * daemon executor. Command-specific schema validation belongs to the shared
 * command registry added in Phase 3. */
export function validateVideoEditorCommandRequest(
  request: unknown,
  currentRevision: number,
): VideoEditorCommandRequest {
  if (!isJsonObject(request) || request.schemaVersion !== 1) {
    throw new VideoEditorHostError(
      'EDITOR_COMMAND_SCHEMA_UNSUPPORTED',
      'Video editor command schemaVersion must be 1',
    );
  }
  const operationId = request.operationId;
  if (typeof operationId !== 'string' || operationId.trim().length === 0) {
    throw new VideoEditorHostError(
      'EDITOR_OPERATION_ID_REQUIRED',
      'Video editor command operationId is required',
    );
  }
  const baseRevision = request.baseRevision;
  if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new VideoEditorHostError(
      'EDITOR_REVISION_CONFLICT',
      'Video editor command baseRevision is invalid',
      { currentRevision },
    );
  }
  if (baseRevision !== currentRevision) {
    throw new VideoEditorHostError(
      'EDITOR_REVISION_CONFLICT',
      `Video editor revision ${String(baseRevision)} is stale; current revision is ${currentRevision}`,
      { baseRevision, currentRevision },
    );
  }
  if (!isJsonObject(request.command)) {
    throw new VideoEditorHostError(
      'EDITOR_COMMAND_INVALID',
      'Video editor command must be an object',
    );
  }
  return request as unknown as VideoEditorCommandRequest;
}

export interface VideoEditorMountManager {
  mount(container: HTMLElement, options: VideoEditorHostOptions): MountedVideoEditor;
}

/** Owns the cross-React lifecycle boundary. A WeakMap prevents duplicate
 * React roots without retaining detached host containers. */
export function createVideoEditorMountManager(
  mountImplementation: VideoEditorMountImplementation,
): VideoEditorMountManager {
  const mountedContainers = new WeakMap<HTMLElement, MountedVideoEditor>();

  return {
    mount(container, options) {
      if (mountedContainers.has(container)) {
        throw new VideoEditorHostError(
          'EDITOR_ALREADY_MOUNTED',
          `Video editor host is already mounted: ${options.hostId}`,
        );
      }

      const implementation = mountImplementation(container, options);
      let unmounted = false;
      const mounted: MountedVideoEditor = {
        // Whatever the implementation offers passes through; the entries below
        // only fill in what it left out. Listing the methods instead of
        // spreading is what once dropped `generateVoiceover` before it reached
        // the host, which then read every answer as "no such caption".
        ...(implementation as Partial<MountedVideoEditor>),
        updateDocument: implementation.updateDocument ?? (() => {}),
        resolveCommand: implementation.resolveCommand ?? (() => {}),
        notify: implementation.notify ?? (() => {}),
        generateVoiceover: implementation.generateVoiceover ?? (async () => ({ status: 'missing' as const })),
        unmount() {
          if (unmounted) return;
          unmounted = true;
          try {
            implementation.unmount();
          } finally {
            mountedContainers.delete(container);
          }
        },
      };
      mountedContainers.set(container, mounted);
      return mounted;
    },
  };
}

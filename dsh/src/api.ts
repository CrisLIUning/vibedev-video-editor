/**
 * The dsh-film calls the editing desk makes: the cut and its history,
 * placements, the film's material, uploads. Paths are Studio's (the plugin
 * answers them through its `studio` routes); the board is the film project.
 */

import type {
  JsonObject,
  VideoEditorAuthorizedAsset,
  VideoEditorProjectFile,
} from '../../packages/video-editor-bridge/src/host-contract.ts';
import { pluginRoot, projectId, toHostUrl, workspace } from './address.ts';

export interface TimelineState {
  document: unknown;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  historyLength: number;
}

/** A save or step whose base revision was overtaken; carries the current state. */
export class TimelineConflictError extends Error {
  override name = 'TimelineConflictError';
  readonly code = 'CANVAS_TIMELINE_CONFLICT';

  constructor(readonly current: TimelineState) {
    super('剪辑在保存途中被别处改过了');
  }
}

/**
 * A refusal from the plugin, with its code when it gave one and the rest of
 * its answer in `extra` — the fields a refusal carries for the page to act on
 * (`detail` of a render refusal, `modelIds` of a consent refusal, `taskId` of
 * a busy renderer).
 */
export class HostRequestError extends Error {
  override name = 'HostRequestError';

  constructor(message: string, readonly status: number, readonly code?: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface FilmProject {
  id: string;
  title: string;
  aspectRatio: string;
}

export interface UploadedFile {
  /** The path the plugin kept, relative to `film/`. */
  name: string;
  size: number;
  mime: string;
}

export interface CommandPlanBody {
  schemaVersion: 1;
  operationId: string;
  dryRun: boolean;
  capabilityTask?: { taskId: string };
  plan: { schemaVersion: 1; baseRevision: number; operations: JsonObject[] };
}

export interface CommandResult {
  committed: boolean;
  revision: number;
  duplicate: boolean;
  appliedOperationIds: string[];
  warnings: unknown[];
}

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
const board = encodeURIComponent(projectId);
const projectQuery = `?project=${encodeURIComponent(projectId)}`;

async function reply<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { current?: TimelineState; error?: unknown; code?: unknown; [field: string]: unknown } | null;
    const error = payload?.error;
    const code = typeof payload?.code === 'string'
      ? payload.code
      : typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
    if (response.status === 409) {
      if (payload?.current && typeof payload.current.revision === 'number') throw new TimelineConflictError(payload.current);
      // A timeline conflict we cannot read is not a cut with no document:
      // adopting one would autosave an empty timeline over the person's work.
      // Other refusals with 409 (a model download not agreed to yet) say what they are.
      if (code === undefined || code.startsWith('CANVAS_TIMELINE')) {
        throw new HostRequestError(`${label}：剪辑已被别处改过，且读不到当前状态`, 409, 'CANVAS_TIMELINE_CONFLICT_UNREADABLE');
      }
    }
    const message = typeof error === 'string' && error !== ''
      ? error
      : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : `${label} (${response.status})`;
    const extra: Record<string, unknown> = {};
    if (payload !== null && typeof payload === 'object') {
      for (const [field, value] of Object.entries(payload)) if (field !== 'error' && field !== 'code') extra[field] = value;
    }
    throw new HostRequestError(message, response.status, code, extra);
  }
  return await response.json() as T;
}

async function studio<T>(path: string, label: string, init: { method?: string; json?: unknown; body?: Blob; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const read = method === 'GET' || method === 'HEAD';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.body !== undefined) {
    headers['content-type'] = init.body.type || 'application/octet-stream';
    body = init.body;
  }
  const response = await fetch(toHostUrl(path, method), {
    method: read ? method : 'POST',
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  return reply<T>(response, label);
}

/** The film project of the workspace, or null when there is none. */
export async function getProject(): Promise<FilmProject | null> {
  const url = new URL('project', pluginRoot());
  url.searchParams.set('cwd', workspace);
  const response = await fetch(url.pathname + url.search, { credentials: 'same-origin' });
  return (await reply<{ project: FilmProject | null }>(response, '读取影视项目')).project;
}

export const getTimeline = (): Promise<TimelineState> =>
  studio(`/api/canvas/timelines/${board}${projectQuery}`, '读取剪辑');

export const saveTimeline = (document: unknown, baseRevision: number): Promise<TimelineState> =>
  studio(`/api/canvas/timelines/${board}${projectQuery}`, '保存剪辑', { method: 'PUT', json: { document, baseRevision } });

export const undoTimeline = (baseRevision: number): Promise<TimelineState> =>
  studio(`/api/canvas/timelines/${board}/undo${projectQuery}`, '撤销', { method: 'POST', json: { baseRevision } });

export const redoTimeline = (baseRevision: number): Promise<TimelineState> =>
  studio(`/api/canvas/timelines/${board}/redo${projectQuery}`, '重做', { method: 'POST', json: { baseRevision } });

export const executeCommands = async (body: CommandPlanBody): Promise<CommandResult> =>
  (await studio<{ result: CommandResult }>(`/api/canvas/timelines/${board}/commands${projectQuery}`, '放到时间线', { method: 'POST', json: body })).result;

export const getMaterial = (signal?: AbortSignal): Promise<{ assets: VideoEditorAuthorizedAsset[]; projectFiles: VideoEditorProjectFile[] }> =>
  studio(`/api/canvas/timelines/${board}/material${projectQuery}`, '读取素材', signal ? { signal } : {});

export const importWorkspaceFile = async (path: string): Promise<UploadedFile> =>
  (await studio<{ file: UploadedFile }>(`/api/canvas/timelines/${board}/import${projectQuery}`, '导入素材', { method: 'POST', json: { path } })).file;

/**
 * Put a file into the film project. With `unique`, an existing file keeps its
 * name and this one takes the first free `-N`; the answer says which.
 */
export const uploadFile = async (path: string, blob: Blob, options: { unique?: boolean } = {}): Promise<UploadedFile> =>
  (await studio<{ file: UploadedFile }>(
    `/api/projects/${board}/raw/${encodePath(path)}${options.unique ? '?unique=1' : ''}`,
    '保存文件',
    { method: 'PUT', body: blob },
  )).file;

/** One media node on the storyboard that plays a film file. */
export interface BoardMedia {
  nodeId: string;
  title: string;
  path: string;
  kind: 'video' | 'image' | 'audio';
  durationSeconds?: number;
}

/** The storyboard's media nodes in board order; none when there is no board yet. */
export async function listBoardMedia(): Promise<BoardMedia[]> {
  try {
    return (await studio<{ media: BoardMedia[] }>(`/api/canvas/timelines/${board}/media${projectQuery}`, '读取画布素材')).media;
  } catch (error) {
    if (error instanceof HostRequestError && error.status === 404) return [];
    throw error;
  }
}

export interface PlacedClip {
  clipId: string;
  track: string;
  path: string;
  name: string;
  start: number;
  durationSeconds: number;
}

/** Put a storyboard node on the cut, built on `baseRevision`. */
export const placeBoardMedia = async (body: { source: { nodeId: string }; baseRevision: number; operationId: string; track?: 'music'; at?: number }): Promise<PlacedClip> =>
  (await studio<{ placed: PlacedClip }>(`/api/canvas/timelines/${board}/place${projectQuery}`, '放到时间线', { method: 'POST', json: body })).placed;

/** Put a film file on the storyboard; `landedNodeId` is null when there is no board to put it on. */
export const landOnBoard = async (body: { path: string; title?: string; durationSeconds?: number }): Promise<{ landedNodeId: string | null }> =>
  (await studio<{ landed: { landedNodeId: string | null } }>(`/api/canvas/timelines/${board}/media${projectQuery}`, '放到画布', { method: 'POST', json: body })).landed;

export interface Slot {
  clipId: string;
  name: string;
  durationSeconds: number;
}

export interface Take {
  path: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  nodeId?: string;
  durationSeconds?: number;
  current: boolean;
  refusal?: string;
}

/** The takes on the storyboard that could fill a clip of the cut. */
export const listVersions = (clipId: string): Promise<{ slot?: Slot; versions: Take[] }> =>
  studio(`/api/canvas/timelines/${board}/versions${projectQuery}&clipId=${encodeURIComponent(clipId)}`, '读取候选版本');

/** Give a clip another take, built on `baseRevision`. */
export const swapVersion = async (body: { clipId: string; source: { nodeId: string } | { path: string }; baseRevision: number; operationId: string }): Promise<{ name: string }> =>
  (await studio<{ swapped: { name: string } }>(`/api/canvas/timelines/${board}/version${projectQuery}`, '换版本', { method: 'POST', json: body })).swapped;

/** A script the 剧本 menu offers: a screenplay of the 剧本 tab (`story:<id>`) or a text node on the board. */
export interface ScriptSource {
  id: string;
  source: 'story' | 'board';
  title: string;
  lineCount: number;
  preview: string;
}

export const listScripts = async (): Promise<ScriptSource[]> =>
  (await studio<{ scripts: ScriptSource[] }>(`/api/canvas/timelines/${board}/scripts${projectQuery}`, '读取剧本')).scripts;

export interface SoundPlaced {
  captionId?: string;
  clipId?: string;
  text?: string;
  start: number;
  end: number;
}

/** A script onto the cut's shots, one caption per line, built on `baseRevision`. */
export const placeSound = (body: { script: { storyDocumentId: string } | { nodeId: string }; baseRevision: number; operationId: string }): Promise<{ items: SoundPlaced[]; warnings: string[] }> =>
  studio(`/api/canvas/timelines/${board}/sound${projectQuery}`, '放字幕', { method: 'POST', json: body });

/** Studio's URL for a film file; cuts and the authorization list keep these. */
export function projectRawUrl(path: string): string {
  return `/api/projects/${board}/raw/${encodePath(path)}`;
}

/** An AI model the editor may download, as the plugin lists it. */
export interface ModelListing {
  id: string;
  label: string;
  capability: string;
  revision: string;
  license: { name: string; notice?: string; url?: string };
  /** Models agreed to together (the caption fonts). */
  group?: string;
  groupSize?: number;
  totalBytes: number;
  sourceHosts: string[];
  artifacts: { id: string; fileName: string; bytes: number }[];
}

export interface ModelTask {
  taskId: string;
  modelId: string;
  status: 'running' | 'done' | 'failed' | 'interrupted';
  progress: number;
  phase: string;
  error?: { code: string; message: string };
}

const modelPath = (modelId: string): string => `/api/media/video-editor-models/${encodeURIComponent(modelId)}`;

export const listModels = (): Promise<{ models: ModelListing[] }> =>
  studio('/api/media/video-editor-models', '读取模型列表');

export const getModelConsent = (modelId: string): Promise<{ modelId: string; granted: boolean }> =>
  studio(`${modelPath(modelId)}/consent`, '读取下载许可');

/** Record the person's answer, for the model's whole group with `group`. */
export const setModelConsent = (modelId: string, granted: boolean, group: boolean): Promise<{ modelIds: string[] }> =>
  studio(`${modelPath(modelId)}/consent`, '记录下载许可', { method: 'POST', json: { granted, group } });

/** Start getting a model ready; refused with `VIDEO_EDITOR_MODEL_CONSENT_REQUIRED` before the person agreed. */
export const prepareModel = (modelId: string): Promise<{ taskId: string }> =>
  studio(`${modelPath(modelId)}/prepare`, '准备模型', { method: 'POST', json: {} });

export const getModelTask = (taskId: string): Promise<ModelTask> =>
  studio(`/api/media/video-editor-model-tasks/${encodeURIComponent(taskId)}`, '读取模型下载进度');

export const cancelModelTask = (taskId: string): Promise<unknown> =>
  studio(`/api/media/video-editor-model-tasks/${encodeURIComponent(taskId)}/cancel`, '取消模型下载', { method: 'POST', json: {} });

/**
 * Where a model file is served: its own route, absolute, so the editor's
 * workers can fetch it and a model's sibling files resolve beside it.
 */
export function modelFileUrl(modelId: string, revision: string, artifactId: string): string {
  return new URL(`models/${modelId}/${revision}/${artifactId}`, pluginRoot()).href;
}

/** A media task as the plugin's long-poll answers it (`/api/media/tasks/:id/wait`). */
export interface TaskSnapshot<File = Record<string, unknown>> {
  taskId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted';
  startedAt: number;
  endedAt: number | null;
  progress: string[];
  nextSince: number;
  file?: File;
  error?: { code?: string; message: string } | null;
}

/** One long-poll step: answers at once when the task ended or has progress after `since`. */
export const waitTask = <File = Record<string, unknown>>(taskId: string, since: number, timeoutMs: number, signal?: AbortSignal): Promise<TaskSnapshot<File>> =>
  studio(`/api/media/tasks/${encodeURIComponent(taskId)}/wait`, '读取任务进度', { method: 'POST', json: { since, timeoutMs }, ...(signal ? { signal } : {}) });

/** Stop a media task; a task that already ended stays as it ended. */
export const cancelTask = (taskId: string): Promise<unknown> =>
  studio(`/api/media/tasks/${encodeURIComponent(taskId)}/cancel`, '取消任务', { method: 'POST', json: {} });

export type CaptionEngineId = 'whisper' | 'gateway';

/** What can recognize speech for this film, as `captions/engines` answers. */
export interface CaptionEngines {
  default: CaptionEngineId;
  engines: Array<
    | { id: 'whisper'; available: boolean; reason?: string; consent: Record<string, boolean>; downloadBytes: number; runner: 'connected' | 'none' }
    | { id: 'gateway'; available: boolean; reason?: string; languages: string[]; model?: string; limits: { maxSeconds: number; maxBytes: number } }
  >;
}

export interface TranscribeBody {
  baseRevision: number;
  requestId: string;
  clipIds?: string[];
  range?: { start: number; end: number };
  language?: string;
  engine?: CaptionEngineId;
  spendingConfirmed?: boolean;
}

export interface TranscriptionStarted {
  taskId: string;
  status: string;
  engine?: CaptionEngineId;
  model?: string;
  estimate?: { seconds: number; amountCny?: number; basis: string };
}

/** One recognition task of this film; `progress` and `error` when the plugin includes them. */
export interface CaptionTaskSummary {
  taskId: string;
  status: TaskSnapshot['status'];
  engine?: CaptionEngineId;
  model?: string;
  startedAt: number;
  endedAt?: number | null;
  applied: boolean;
  segments?: number;
  ranges?: Array<{ start: number; end: number }>;
  progress?: string[];
  error?: { code?: string; message: string } | null;
}

/** One line of a recognition draft: timeline seconds, and where it came from in the original audio. */
export interface CaptionDraftSegment {
  id: string;
  text: string;
  warnings?: string[];
  start: number;
  end: number;
  sourceClipId: string;
  sourceIn: number;
  sourceOut: number;
}

/** An unreviewed recognition draft (Studio's `TimelineCaptionDraft`, plus the engine). */
export interface CaptionDraft {
  kind: 'timeline-caption-draft';
  schemaVersion: 1;
  baseRevision: number;
  model: string;
  engine?: CaptionEngineId;
  reviewStatus: 'unreviewed';
  ranges: Array<{ start: number; end: number }>;
  sources: Array<{ clipId: string; track?: string; file: string; start: number; end: number; sourceIn: number; sourceOut: number }>;
  segments: CaptionDraftSegment[];
}

export const getCaptionEngines = (): Promise<CaptionEngines> =>
  studio(`/api/canvas/timelines/${board}/captions/engines${projectQuery}`, '读取识别方式');

/** Start recognizing the saved cut's original audio in the background. */
export const startTranscription = (body: TranscribeBody): Promise<TranscriptionStarted> =>
  studio(`/api/canvas/timelines/${board}/transcribe${projectQuery}`, '提交字幕识别', { method: 'POST', json: body });

export const listCaptionTasks = (signal?: AbortSignal): Promise<{ tasks: CaptionTaskSummary[] }> =>
  studio(`/api/canvas/timelines/${board}/captions/tasks${projectQuery}`, '读取字幕识别任务', signal ? { signal } : {});

/** Write a reviewed draft's captions into its ranges; `dryRun` only checks. */
export const applyCaptions = async (body: { taskId: string; reviewed: boolean; dryRun: boolean; excludeSegmentIds?: string[] }): Promise<CommandResult> =>
  (await studio<{ result: CommandResult }>(`/api/canvas/timelines/${board}/captions/apply${projectQuery}`, '写入字幕', { method: 'POST', json: body })).result;

export interface RenderBody {
  baseRevision?: number;
  frameRate?: 24 | 30 | 60;
  resolution?: '720' | '1080' | '1440' | '2160';
  fileName?: string;
}

export interface RenderCheck {
  ok: true;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  hasAudio: boolean;
  targetLoudnessLufs?: number;
  outputPath: string;
}

/** The file a finished render task carries (`name` is relative to `film/`). */
export interface RenderedFile {
  name: string;
  size: number;
  kind: 'video';
  mime: string;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
  loudnessLufs?: number;
  sha256: string;
  landedNodeId?: string | null;
}

/** Have the plugin render the saved cut with ffmpeg into `film/canvas/renders/`; follow the task with `waitTask`. */
export const renderTimeline = (body: RenderBody): Promise<{ taskId: string }> =>
  studio(`/api/canvas/timelines/${board}/render${projectQuery}`, '提交渲染', { method: 'POST', json: body });

/** Would the plugin render this cut? The same refusals as a render, no task, no file. */
export const checkRender = (body: RenderBody): Promise<RenderCheck> =>
  studio(`/api/canvas/timelines/${board}/render${projectQuery}`, '检查渲染', { method: 'POST', json: { ...body, check: true } });

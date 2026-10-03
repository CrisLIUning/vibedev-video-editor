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

/** A refusal from the plugin, with its code when it gave one. */
export class HostRequestError extends Error {
  override name = 'HostRequestError';

  constructor(message: string, readonly status: number, readonly code?: string) {
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
  if (response.status === 409) {
    const payload = await response.json().catch(() => null) as { current?: TimelineState; error?: unknown } | null;
    // A 409 we cannot read is not a cut with no document: adopting one would
    // autosave an empty timeline over the person's work.
    if (payload?.current && typeof payload.current.revision === 'number') throw new TimelineConflictError(payload.current);
    throw new HostRequestError(`${label}：剪辑已被别处改过，且读不到当前状态`, 409, 'CANVAS_TIMELINE_CONFLICT_UNREADABLE');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    const error = payload?.error;
    const message = typeof error === 'string' && error !== ''
      ? error
      : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : `${label} (${response.status})`;
    const code = typeof payload?.code === 'string'
      ? payload.code
      : typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
    throw new HostRequestError(message, response.status, code);
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

/** Studio's URL for a film file; cuts and the authorization list keep these. */
export function projectRawUrl(path: string): string {
  return `/api/projects/${board}/raw/${encodePath(path)}`;
}

import type { JsonObject, JsonValue } from '../host-contract.js';
import { normalizeVideoEditorCommandDiff, type VideoEditorCommandDiff } from './diff.js';
import { getVideoEditorCommand } from './registry.js';

// The vendored engine is deliberately consumed in place. This wrapper is the
// stable typed boundary; keeping the implementation upstream-owned avoids a
// second, drifting copy of timeline edit algorithms.
// @ts-expect-error The pinned upstream module is JavaScript and has no declarations.
import { applyCommandPlan, inspectProject, inspectTrack } from '../../../../vendor/ai-video-editor/src/lib/projectCommandEngine.js';

export interface VideoEditorCommandOperation extends JsonObject {
  id: string;
  type: string;
}

export interface VideoEditorCommandPlan {
  schemaVersion: 1;
  baseRevision: number;
  operations: VideoEditorCommandOperation[];
}

export interface VideoEditorProjectInspection extends JsonObject {
  schemaVersion: number;
  revision: number;
  duration: number;
  ratio: string;
  tracks: JsonObject;
  appliedOperationIds: JsonValue[];
  warnings: JsonValue[];
}

export interface VideoEditorCommandFailure {
  ok: false;
  code: string;
  message: string;
  operationId?: string;
}

export type VideoEditorCommandExecutionResult =
  | {
      ok: true;
      revision: number;
      appliedOperationIds: string[];
      warnings: JsonValue[];
      document: JsonObject;
      before: VideoEditorProjectInspection;
      after: VideoEditorProjectInspection;
      changes: VideoEditorCommandDiff;
    }
  | VideoEditorCommandFailure;

function failure(code: string, message: string, operationId?: string): VideoEditorCommandFailure {
  return { ok: false, code, message, ...(operationId ? { operationId } : {}) };
}

function cloneObject(value: JsonObject): JsonObject {
  return structuredClone(value);
}

function projectFromDocument(document: JsonObject): JsonObject | undefined {
  const project = document.project;
  return project && typeof project === 'object' && !Array.isArray(project)
    ? project as JsonObject
    : undefined;
}

function validateDocument(document: JsonObject):
  | { ok: true; project: JsonObject }
  | VideoEditorCommandFailure {
  if (document.format !== 'timeline-studio-archive' || document.version !== 3) {
    return failure('INVALID_TIMELINE_DOCUMENT', 'Expected a Timeline Studio v3 archive');
  }
  const project = projectFromDocument(document);
  if (!project) return failure('INVALID_TIMELINE_DOCUMENT', 'Timeline archive project is missing');
  return { ok: true, project };
}

export function inspectVideoEditorDocument(document: JsonObject): VideoEditorProjectInspection {
  const validation = validateDocument(document);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.message), { code: validation.code });
  }
  return inspectProject(validation.project) as VideoEditorProjectInspection;
}

export const VIDEO_EDITOR_TRACKS = ['visuals', 'captions', 'audio', 'stickers', 'overlays', 'music'] as const;
export type VideoEditorTrackName = (typeof VIDEO_EDITOR_TRACKS)[number];

/** One clip as the command engine addresses it: the id every
 *  `timed.*` / `visual.*` / `clip.*` command takes, with its timing. */
export interface VideoEditorClipInspection extends JsonObject {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
}

export interface VideoEditorTrackInspection extends JsonObject {
  schemaVersion: number;
  revision: number;
  track: VideoEditorTrackName;
  visible: boolean;
  locked: boolean;
  clipCount: number;
  duration: number;
  clips: VideoEditorClipInspection[];
}

/**
 * Per-track clip listing. `inspectVideoEditorDocument` only counts clips,
 * which is not enough to drive a command: an agent needs the clip ids and
 * their timing to target `timed.move`, `visual.trim`, `clip.set_speed`…
 */
export function inspectVideoEditorTracks(
  document: JsonObject,
): Record<VideoEditorTrackName, VideoEditorTrackInspection> {
  const validation = validateDocument(document);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.message), { code: validation.code });
  }
  const out = {} as Record<VideoEditorTrackName, VideoEditorTrackInspection>;
  for (const track of VIDEO_EDITOR_TRACKS) {
    out[track] = inspectTrack(validation.project, track) as VideoEditorTrackInspection;
  }
  return out;
}

function record(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/** The upstream engine owns timing and edit algorithms. This pass tracks only
 * host-owned provenance by clip identity, including clips created and split
 * inside the same plan. Replayed operation IDs never alter a saved snapshot. */
function retainStoryProvenance(before: JsonObject, after: JsonObject, plan: VideoEditorCommandPlan, appliedIds: string[]): void {
  const collections = ['visualSegments', 'audioSegments', 'musicSegments', 'visualOverlaySegments'] as const;
  const lineage = new Map<string, JsonObject>();
  for (const key of collections) {
    const clips = before[key];
    if (!Array.isArray(clips)) continue;
    for (const raw of clips) {
      const clip = record(raw);
      if (!clip || typeof clip.id !== 'string') continue;
      const metadata: JsonObject = {};
      if (Object.hasOwn(clip, 'storyMediaSource')) metadata.storyMediaSource = structuredClone(clip.storyMediaSource!);
      if (Object.hasOwn(clip, 'director')) metadata.director = structuredClone(clip.director!);
      lineage.set(clip.id, metadata);
    }
  }
  const applied = new Set(appliedIds);
  for (const operation of plan.operations) {
    if (!applied.has(operation.id)) continue;
    if (operation.type === 'asset.import' && typeof operation.clipId === 'string') {
      const previous = typeof operation.replaceClipId === 'string' ? lineage.get(operation.replaceClipId) : undefined;
      const director = previous?.director ?? operation.director;
      // Replacements may keep their slot id; remove the old lineage before
      // writing the new material or we would delete the replacement itself.
      if (typeof operation.replaceClipId === 'string') lineage.delete(operation.replaceClipId);
      lineage.set(operation.clipId.trim(), {
        // A newly imported file cannot inherit the former file's generation.
        storyMediaSource: structuredClone(record(operation.storyMediaSource) ?? null),
        ...(director !== undefined ? { director: structuredClone(director) } : {}),
      });
    } else if (operation.type === 'visual.split' && typeof operation.clipId === 'string' && typeof operation.rightClipId === 'string') {
      lineage.set(operation.rightClipId.trim(), structuredClone(lineage.get(operation.clipId) ?? {}));
    } else if (operation.type === 'visual.append' && typeof operation.clipId === 'string' && typeof operation.sourceClipId === 'string') {
      lineage.set(operation.clipId.trim(), structuredClone(lineage.get(operation.sourceClipId) ?? {}));
    } else if (operation.type === 'clip.delete' && typeof operation.clipId === 'string') lineage.delete(operation.clipId);
  }
  for (const key of collections) {
    const clips = after[key];
    if (!Array.isArray(clips)) continue;
    for (const raw of clips) {
      const clip = record(raw);
      if (!clip || typeof clip.id !== 'string') continue;
      const metadata = lineage.get(clip.id);
      if (metadata) Object.assign(clip, structuredClone(metadata));
    }
  }
}

export function executeVideoEditorCommandPlan(
  document: JsonObject,
  plan: VideoEditorCommandPlan,
): VideoEditorCommandExecutionResult {
  const validation = validateDocument(document);
  if (!validation.ok) return validation;

  for (const operation of plan.operations) {
    const descriptor = getVideoEditorCommand(operation.type);
    if (!descriptor) {
      return failure('UNKNOWN_OPERATION', `Unknown operation type: ${operation.type}`, operation.id);
    }
    if (descriptor.availability !== 'native') {
      return failure(
        'COMMAND_REQUIRES_UI_FALLBACK',
        `${operation.type} is not yet exposed by the upstream command engine`,
        operation.id,
      );
    }
  }

  const candidate = cloneObject(document);
  const project = projectFromDocument(candidate);
  if (!project) return failure('INVALID_TIMELINE_DOCUMENT', 'Timeline archive project is missing');
  const previousState = project.commandState;
  const previousOperationIds = previousState && typeof previousState === 'object' && !Array.isArray(previousState)
    && Array.isArray(previousState.appliedOperationIds)
    ? previousState.appliedOperationIds
    : [];
  project.commandState = {
    schemaVersion: 1,
    revision: plan.baseRevision,
    appliedOperationIds: previousOperationIds,
  };

  const result = applyCommandPlan(project, plan) as Record<string, unknown>;
  if (result.ok !== true) {
    return failure(
      typeof result.code === 'string' ? result.code : 'COMMAND_FAILED',
      typeof result.message === 'string' ? result.message : 'Timeline command failed',
      typeof result.operationId === 'string' ? result.operationId : undefined,
    );
  }
  candidate.project = result.project as JsonObject;
  retainStoryProvenance(project, candidate.project, plan, result.appliedOperationIds as string[]);
  return {
    ok: true,
    revision: Number(result.revision),
    appliedOperationIds: result.appliedOperationIds as string[],
    warnings: result.warnings as JsonValue[],
    document: candidate,
    before: result.before as VideoEditorProjectInspection,
    after: result.after as VideoEditorProjectInspection,
    changes: normalizeVideoEditorCommandDiff(result.changes),
  };
}

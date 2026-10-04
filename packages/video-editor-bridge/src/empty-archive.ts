import type { JsonObject } from './host-contract.js';

/**
 * What a cut looks like before anyone has made one.
 *
 * The editor and the command engine both refuse anything that is not a
 * Timeline Studio v3 archive with a `project` inside, so "no cut yet" cannot
 * be `null` or an empty object on either side of the host boundary. This is
 * the same skeleton the production store used for a fresh composite; a board
 * that has never been cut gets it too, with the board's aspect if it has one.
 */
export function createEmptyTimelineArchive(ratioId?: string): JsonObject {
  return {
    format: 'timeline-studio-archive',
    version: 3,
    project: {
      ...(ratioId ? { ratioId } : {}),
      visualSegments: [],
      visualOverlaySegments: [],
      audioSegments: [],
      musicSegments: [],
      captionSegments: [],
    },
    media: { visuals: [], overlays: [], audioSegments: [], audio: null, sourceAudio: null, music: null },
    vibedevBootstrap: { source: 'canvas-board' },
  } as unknown as JsonObject;
}

/** The three facts the engine checks before it will touch a document. */
export function isTimelineArchive(value: unknown): value is JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const archive = value as Record<string, unknown>;
  return archive.format === 'timeline-studio-archive'
    && archive.version === 3
    && !!archive.project && typeof archive.project === 'object' && !Array.isArray(archive.project);
}

/** Where a project keeps the clips of each of the engine's tracks (its `TRACK_COLLECTIONS`). */
const CLIP_COLLECTIONS = [
  'visualSegments',
  'visualOverlaySegments',
  'audioSegments',
  'musicSegments',
  'captionSegments',
  'stickerSegments',
] as const;

/**
 * Whether a cut has nothing on it: no document yet (`null`), or an archive
 * with no clip on any track — a caption or a sticker counts as a clip. A
 * document that is not an archive is not called empty: what it holds is
 * unknown.
 */
export function isEmptyTimeline(document: unknown): boolean {
  if (document === null || document === undefined) return true;
  if (!isTimelineArchive(document)) return false;
  const project = document.project as Record<string, unknown>;
  return CLIP_COLLECTIONS.every((key) => {
    const clips = project[key];
    return !Array.isArray(clips) || clips.length === 0;
  });
}

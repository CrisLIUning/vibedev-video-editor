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

import { describe, expect, it } from 'vitest';
import { createEmptyTimelineArchive, executeVideoEditorCommandPlan, type JsonObject, type VideoEditorCommandPlan } from '../src/index.js';

const source = (id: string): JsonObject => ({ projectId: 'film', boardId: 'board', path: `${id}.mp4`, sha256: id, outputs: [{ requestId: id, adoption: { documentId: 'doc', objectId: 'shot', revision: id } }] });
const director: JsonObject = { shotId: 'slot', cameraId: 'camera', storySources: [{ preview: { documentId: 'doc', objectId: 'shot', revision: 'intended' }, scope: { kind: 'document' }, linkedAt: '2026-09-07' }] };
const imported = (id: string, more: JsonObject = {}): JsonObject => ({ id: `place-${id}`, type: 'asset.import', clipId: id, track: 'visuals', prepared: true, mediaType: 'video', assetId: id, assetVersionId: id, sourceUrl: `/${id}.mp4`, archivePath: `${id}.mp4`, sha256: id, size: 10, mimeType: 'video/mp4', duration: 6, ...more });
function execute(document: JsonObject, operations: JsonObject[], baseRevision = 0) {
  const result = executeVideoEditorCommandPlan(document, { schemaVersion: 1, baseRevision, operations } as VideoEditorCommandPlan);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}
const visuals = (document: JsonObject) => (document.project as JsonObject).visualSegments as JsonObject[];

describe('host-owned story provenance around the unchanged upstream edit engine', () => {
  it('keeps exact lineage across a same-plan placement, split, trim, reorder and different-file replacement', () => {
    const original = createEmptyTimelineArchive();
    const result = execute(original, [
      imported('a', { storyMediaSource: source('generated-a'), director }),
      { id: 'split', type: 'visual.split', clipId: 'a', at: 2, rightClipId: 'b' },
      { id: 'trim', type: 'visual.trim', clipId: 'b', sourceIn: 2, sourceOut: 5 },
      { id: 'reorder', type: 'visual.reorder', clipId: 'b', toIndex: 0 },
      imported('c', { replaceClipId: 'b', storyMediaSource: source('generated-c'), director: { shotId: 'new-file-has-other-intent' } }),
    ]);
    expect(visuals(result.document)).toMatchObject([
      { id: 'c', duration: 3, director, storyMediaSource: source('generated-c') },
      { id: 'a', duration: 2, director, storyMediaSource: source('generated-a') },
    ]);
    expect(visuals(original)).toEqual([]);
  });

  it('clears only former output attribution on an untracked replacement and remains idempotent', () => {
    const placed = execute(createEmptyTimelineArchive(), [imported('a', { storyMediaSource: source('generated-a'), director })]);
    const replacement = imported('unknown', { replaceClipId: 'a' });
    const replaced = execute(placed.document, [replacement], placed.revision);
    expect(visuals(replaced.document)[0]).toMatchObject({ id: 'unknown', director, storyMediaSource: null });
    const replay = execute(replaced.document, [{ ...replacement, storyMediaSource: source('must-not-be-added') }], replaced.revision);
    expect(replay.appliedOperationIds).toEqual([]);
    expect(replay.document).toEqual(replaced.document);
  });

  it.each([
    ['visuals', true], ['visuals', false], ['audio', true], ['audio', false],
  ] as const)('replaces a %s slot in place with tracked=%s material without inheriting its former output', (track, tracked) => {
    const collection = track === 'visuals' ? 'visualSegments' : 'audioSegments';
    const mediaType = track === 'visuals' ? 'video' : 'audio';
    const placed = execute(createEmptyTimelineArchive(), [
      imported('slot', { track, mediaType, storyMediaSource: source('slot'), director }),
    ]);
    const replacement = imported('new-material', {
      track, mediaType, clipId: 'slot', replaceClipId: 'slot',
      director: { shotId: 'new-file-has-other-intent' },
      ...(tracked ? { storyMediaSource: source('new-material') } : {}),
    });
    const replaced = execute(placed.document, [replacement], placed.revision);
    const clips = (replaced.document.project as JsonObject)[collection] as JsonObject[];
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      id: 'slot', assetVersionId: 'new-material', director,
      storyMediaSource: tracked ? source('new-material') : null,
    });
    const replay = execute(replaced.document, [{ ...replacement, storyMediaSource: source('must-not-be-added') }], replaced.revision);
    expect(replay.appliedOperationIds).toEqual([]);
    expect(replay.document).toEqual(replaced.document);
  });

  it('keeps audio/music file attribution and copies visual lineage when appending an existing clip', () => {
    const result = execute(createEmptyTimelineArchive(), [
      imported('a', { storyMediaSource: source('a'), director }),
      { id: 'append', type: 'visual.append', clipId: 'copy', sourceClipId: 'a' },
      imported('voice', { track: 'audio', mediaType: 'audio', storyMediaSource: source('voice') }),
      imported('music', { track: 'music', mediaType: 'audio', storyMediaSource: source('music') }),
    ]);
    const project = result.document.project as JsonObject;
    expect(visuals(result.document)[1]).toMatchObject({ id: 'copy', storyMediaSource: source('a'), director });
    expect(project.audioSegments).toMatchObject([{ id: 'voice', storyMediaSource: source('voice') }]);
    expect(project.musicSegments).toMatchObject([{ id: 'music', storyMediaSource: source('music') }]);
  });
});

import { describe, expect, it } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import topbarSource from '../../../vendor/ai-video-editor/src/components/Topbar.jsx?raw';
import { executeVideoEditorCommandPlan } from '../src/index.js';

/**
 * A slot keeps its name when its material changes.
 *
 * Upstream's importer demands a fresh clip id for every import, replacement
 * included, because there an id is just a handle. In this fork it is an
 * identity: a visual clip's id is the shot it stands for (the desk lands
 * `clipId = shotId`), and an audio clip's id is what a caption is linked to.
 * A version swap that renamed the slot would rename the shot and detach the
 * caption, so replacing a clip with its own id is allowed here — and this is
 * what an upstream sync has to notice.
 */

function archive(project: Record<string, unknown>) {
  return {
    format: 'timeline-studio-archive',
    version: 3,
    project: {
      name: 'demo',
      commandState: { schemaVersion: 1, revision: 1, appliedOperationIds: [] },
      captionSegments: [],
      audioSegments: [],
      visualSegments: [],
      ...project,
    },
  };
}

function place(overrides: Record<string, unknown>) {
  return {
    id: 'op-1',
    type: 'asset.import',
    prepared: true,
    mediaType: 'video',
    track: 'visuals',
    sha256: 'a'.repeat(64),
    size: 10,
    mimeType: 'video/mp4',
    archivePath: 'canvas/uploads/take2.mp4',
    assetVersionId: 'canvas-file:canvas/uploads/take2.mp4',
    assetId: 'canvas-file:canvas/uploads/take2.mp4',
    sourceUrl: '/api/projects/film/raw/canvas/uploads/take2.mp4',
    duration: 3,
    ...overrides,
  };
}

const CUT = archive({
  visualSegments: [{
    id: 'shot-a',
    type: 'video',
    name: '第 1 镜',
    duration: 3,
    sourceStart: 0,
    sourceDuration: 3,
    playbackRate: 1,
    director: { shotId: 'shot-a', cameraId: 'cam_1' },
    integrity: { sha256: 'b'.repeat(64), size: 9, mimeType: 'video/mp4', archivePath: 'canvas/uploads/take1.mp4' },
  }],
});

describe('replacing a clip with its own id', () => {
  it("keeps the id, the shot it stands for, and the slot's length", () => {
    const result = executeVideoEditorCommandPlan(CUT, {
      schemaVersion: 1,
      baseRevision: 1,
      operations: [place({ clipId: 'shot-a', replaceClipId: 'shot-a', name: '第 1 镜' })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const visuals = (result.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments;
    expect(visuals).toHaveLength(1);
    const clip = visuals[0]!;
    expect(clip).toMatchObject({ id: 'shot-a', duration: 3, director: { shotId: 'shot-a', cameraId: 'cam_1' } });
    expect((clip.integrity as { archivePath: string }).archivePath).toBe('canvas/uploads/take2.mp4');
  });

  it('still refuses an id another clip already holds', () => {
    const result = executeVideoEditorCommandPlan(CUT, {
      schemaVersion: 1,
      baseRevision: 1,
      operations: [place({ clipId: 'shot-a' })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CLIP_ALREADY_EXISTS');
  });
});

/**
 * The picker needs to know which clip is meant, and the editor is the only
 * one who knows. Both halves live in the vendored source, where an upstream
 * refresh has to look: the App lends its selection through the bridge, and
 * the file menu asks the host for that clip's takes.
 */
describe('which clip the takes are for', () => {
  it("lends the editor's selection, read fresh rather than closed over", () => {
    // The bridge connects once, so a selection read from the render that
    // happened to connect would be the selection forever.
    expect(appSource).toContain('hostSelectionRef.current = { selectedTrack, selectedVisualSegmentId, selectedAudioSegmentId, musicSegments };');
    const lend = appSource.slice(appSource.indexOf('selectedClip: () => {'), appSource.indexOf('generateVoiceover: async (captionId)'));
    expect(lend).toContain('hostSelectionRef.current');
    for (const track of ['visuals', 'audio', 'music']) expect(lend).toContain(`track: "${track}"`);
  });

  it("asks the host for that clip's takes when the file menu opens", () => {
    expect(topbarSource).toContain('hostBridge?.hostActions?.versions');
    expect(topbarSource).toContain('hostVersions.list()');
    // A take the slot cannot play is shown with its reason and not offered.
    expect(topbarSource).toContain('disabled={Boolean(hostSwapping) || Boolean(item.refusal)}');
  });
});

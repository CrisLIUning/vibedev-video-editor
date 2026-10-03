import { describe, expect, it } from 'vitest';

import {
  executeVideoEditorCommandPlan,
  inspectVideoEditorDocument,
  listVideoEditorCommands,
} from '../src/index.js';

function archive() {
  return {
    format: 'timeline-studio-archive',
    version: 3,
    futureArchiveField: { keep: true },
    media: { visuals: [{ id: 'visual-1', path: 'media/visual-1.mp4' }] },
    project: {
      name: 'demo',
      futureProjectField: 'preserve-me',
      commandState: { schemaVersion: 1, revision: 2, appliedOperationIds: [] },
      visualSegments: [{
        id: 'visual-1',
        type: 'video',
        duration: 8,
        sourceStart: 0,
        sourceDuration: 8,
        playbackRate: 1,
      }],
      audioSegments: [],
      captionSegments: [],
    },
  };
}

describe('shared video editor command registry', () => {
  it('advertises implemented and explicit compatibility-fallback commands', () => {
    const commands = listVideoEditorCommands();

    expect(commands).toContainEqual(expect.objectContaining({
      type: 'visual.split',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'asset.place_version',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'keyframe.add',
      availability: 'ui-fallback',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'color.set',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'filter.set',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'effect.set',
      availability: 'ui-fallback',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'effect.apply',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'effect.remove',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'music.automation.set',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({ type: 'audio.set_loudness', availability: 'native' }));
    expect(commands).toContainEqual(expect.objectContaining({
      type: 'subject.effect.set',
      availability: 'native',
    }));
    expect(commands).toContainEqual(expect.objectContaining({ type: 'depth.effect.set', availability: 'native' }));
    expect(commands).toContainEqual(expect.objectContaining({ type: 'parallax.set', availability: 'native' }));
  });

  it('executes the vendored command engine without dropping unknown archive fields', () => {
    const result = executeVideoEditorCommandPlan(archive(), {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{ id: 'split-1', type: 'visual.split', clipId: 'visual-1', at: 3, rightClipId: 'visual-2' }],
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 3,
      appliedOperationIds: ['split-1'],
      document: {
        futureArchiveField: { keep: true },
        media: { visuals: [{ id: 'visual-1', path: 'media/visual-1.mp4' }] },
        project: {
          futureProjectField: 'preserve-me',
          visualSegments: [
            { id: 'visual-1', duration: 3, sourceDuration: 3 },
            { id: 'visual-2', duration: 5, sourceStart: 3, sourceDuration: 5 },
          ],
        },
      },
      changes: { tracks: { visuals: expect.any(Object) } },
    });
  });

  it('uses the durable document revision as the concurrency boundary', () => {
    const stale = archive();
    stale.project.commandState.revision = 1;

    const result = executeVideoEditorCommandPlan(stale, {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{ id: 'ratio-1', type: 'project.set_ratio', ratio: '9:16' }],
    });

    expect(result).toMatchObject({ ok: true, revision: 3 });
    if (result.ok) {
      expect(result.document.project).toMatchObject({
        ratioId: '9:16',
        commandState: { revision: 3 },
      });
    }
  });

  it('returns compact inspection data rather than the full project JSON', () => {
    expect(inspectVideoEditorDocument(archive())).toEqual(expect.objectContaining({
      revision: 2,
      tracks: expect.objectContaining({ visuals: 1, audio: 0 }),
    }));
    expect(inspectVideoEditorDocument(archive())).not.toHaveProperty('project');
  });

  it('rejects unsupported commands before entering the upstream reducer', () => {
    expect(executeVideoEditorCommandPlan(archive(), {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{ id: 'effect-1', type: 'effect.set', clipId: 'visual-1' }],
    })).toEqual(expect.objectContaining({
      ok: false,
      code: 'COMMAND_REQUIRES_UI_FALLBACK',
      operationId: 'effect-1',
    }));
  });

  it('applies and removes only versioned allowlisted effects', () => {
    const applied = executeVideoEditorCommandPlan(archive(), {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{
        id: 'effect-1', type: 'effect.apply', clipId: 'visual-1',
        effectId: 'vibedev.blur', effectVersion: 1, parameters: { radius: 7.5 },
      }],
    });

    expect(applied).toMatchObject({
      ok: true,
      revision: 3,
      document: { project: { visualSegments: [{
        id: 'visual-1',
        effects: [{ id: 'vibedev.blur', version: 1, parameters: { radius: 7.5 } }],
      }] } },
    });
    if (!applied.ok) throw new Error('effect apply should succeed');

    const removed = executeVideoEditorCommandPlan(applied.document, {
      schemaVersion: 1,
      baseRevision: 3,
      operations: [{
        id: 'effect-2', type: 'effect.remove', clipId: 'visual-1',
        effectId: 'vibedev.blur',
      }],
    });
    expect(removed).toMatchObject({
      ok: true,
      revision: 4,
      document: { project: { visualSegments: [{ id: 'visual-1', effects: [] }] } },
    });
  });

  it('lets agents configure a subject or object effect only after immutable analysis exists', () => {
    const source = archive();
    Object.assign(source.project.visualSegments[0]!, {
      assetId: 'source-asset',
      assetVersionId: 'source-version',
      vision: { hostAnalysis: {
        kind: 'video-analysis-record', analysisId: 'analysis-1', analysisKind: 'object',
        source: { assetId: 'source-asset', versionId: 'source-version', clipId: 'visual-1' },
        artifacts: [{
          role: 'object-mask', assetId: 'mask-asset', versionId: 'mask-version',
          sourceUrl: '/api/projects/project-1/raw/analysis/object-mask.webm',
        }],
      } },
    });

    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{
        id: 'subject-effect-1', type: 'subject.effect.set', clipId: 'visual-1',
        effect: {
          enabled: true, targetKind: 'object',
          outline: { enabled: true, color: '#32ead8', width: 5, opacity: 0.8, glow: 0 },
          background: { mode: 'color', color: '#17252b', visible: true },
        },
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      document: { project: { visualSegments: [{
        id: 'visual-1', subjectEffect: {
          enabled: true, targetKind: 'object',
          outline: { enabled: true, color: '#32ead8', width: 5, opacity: 0.8 },
          background: { mode: 'color', color: '#17252b', visible: true },
        },
      }] } },
    });

    expect(executeVideoEditorCommandPlan(archive(), {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{
        id: 'subject-effect-missing', type: 'subject.effect.set', clipId: 'visual-1',
        effect: { enabled: true, targetKind: 'person', outline: { enabled: true } },
      }],
    })).toMatchObject({
      ok: false, code: 'ANALYSIS_ASSET_REQUIRED', operationId: 'subject-effect-missing',
    });
  });

  it.each([
    ['depth.effect.set', 'cinematicDepth', { enabled: true, focus: 0.7, focusRange: 0.15, blur: 12 }],
    ['parallax.set', 'photoParallax', { enabled: true, direction: 'orbit', strength: 0.6, speed: 1 }],
  ])('lets agents configure %s only against pinned depth analysis', (type, field, effect) => {
    const source = archive();
    if (type === 'parallax.set') source.project.visualSegments[0]!.type = 'image';
    Object.assign(source.project.visualSegments[0]!, {
      assetId: 'source-asset', assetVersionId: 'source-version',
      depth: { hostAnalysis: {
        kind: 'video-analysis-record', analysisId: 'depth-1', analysisKind: 'depth',
        source: { assetId: 'source-asset', versionId: 'source-version', clipId: 'visual-1' },
        artifacts: [{ role: 'depth-map', assetId: 'depth-asset', versionId: 'depth-version',
          sourceUrl: '/api/projects/project-1/raw/analysis/depth.webm' }],
      } },
    });
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1, baseRevision: 2,
      operations: [{ id: `operation-${type}`, type, clipId: 'visual-1', effect }],
    });
    expect(result).toMatchObject({ ok: true, document: { project: { visualSegments: [{
      id: 'visual-1', [field]: expect.objectContaining(effect),
    }] } } });
  });

  it.each([
    [{ effectId: 'project.javascript', effectVersion: 1, parameters: {} }, 'UNSUPPORTED_RENDER_FEATURE'],
    [{ effectId: 'vibedev.blur', effectVersion: 99, parameters: { radius: 4 } }, 'UNSUPPORTED_RENDER_FEATURE'],
    [{ effectId: 'vibedev.blur', effectVersion: 1, parameters: { radius: 400 } }, 'EFFECT_PARAMETERS_INVALID'],
    [{ effectId: 'vibedev.preview-outline', effectVersion: 1, parameters: {} }, 'UNSUPPORTED_RENDER_FEATURE'],
  ])('rejects unsafe or undeliverable effect %# without mutating the archive', (effect, code) => {
    const source = archive();
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{ id: 'effect-invalid', type: 'effect.apply', clipId: 'visual-1', ...effect }],
    });

    expect(result).toMatchObject({ ok: false, code, operationId: 'effect-invalid' });
    expect(source.project.visualSegments[0]).not.toHaveProperty('effects');
    expect(source.project.commandState).toEqual({ schemaVersion: 1, revision: 2, appliedOperationIds: [] });
  });

  it('replaces one visual source while preserving its edit metadata', () => {
    const source = archive();
    Object.assign(source.project.visualSegments[0]!, {
      duration: 4,
      sourceStart: 6,
      sourceDuration: 8,
      playbackRate: 2,
      muted: true,
      speedCurve: [{ time: 0, rate: 1.5 }, { time: 4, rate: 2.5 }],
      crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
      keyframes: [{ id: 'kf-1', time: 1, property: 'opacity', value: 0.5 }],
    });
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{
        id: 'replace-source', type: 'asset.import', clipId: 'visual-restored',
        replaceClipId: 'visual-1', track: 'visuals', prepared: true, mediaType: 'video',
        assetId: 'asset-restored', assetVersionId: 'version-restored',
        sourceUrl: '/api/projects/project/raw/restored.webm', archivePath: 'restored.webm',
        sha256: 'abc', size: 4, mimeType: 'video/webm', duration: 8, width: 1280, height: 720,
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      document: { project: { visualSegments: [{
        id: 'visual-restored', assetId: 'asset-restored', assetVersionId: 'version-restored',
        width: 1280, height: 720, duration: 4, sourceStart: 0, sourceDuration: 8,
        playbackRate: 2, muted: true,
        speedCurve: [{ time: 0, rate: 1.5 }, { time: 4, rate: 2.5 }],
        crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
        keyframes: [{ id: 'kf-1' }],
      }] } },
    });
  });

  it('replaces one generated voice clip without clearing the rest of the audio track', () => {
    const source = archive() as any;
    source.project.audioSegments = [
      { id: 'voice-old', start: 2, duration: 1, name: 'old' },
      { id: 'voice-keep', start: 5, duration: 2, name: 'keep' },
    ];
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1,
      baseRevision: 2,
      operations: [{
        id: 'replace-voice', type: 'asset.import', clipId: 'voice-new',
        replaceClipId: 'voice-old', track: 'audio', prepared: true, mediaType: 'audio',
        assetId: 'asset-new', assetVersionId: 'version-new', sourceUrl: '/voice.wav',
        archivePath: 'voice.wav', sha256: 'abc', size: 4, mimeType: 'audio/wav',
        duration: 1.5, start: 2,
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      document: { project: { audioSegments: [
        { id: 'voice-new', assetVersionId: 'version-new', start: 2, duration: 1.5 },
        { id: 'voice-keep', start: 5, duration: 2 },
      ] } },
    });
  });

  it('adds, updates, and removes a prepared Sticker without losing its asset identity', () => {
    const added = executeVideoEditorCommandPlan(archive(), {
      schemaVersion: 1, baseRevision: 2,
      operations: [{
        id: 'sticker-add-1', type: 'sticker.add', clipId: 'sticker-1',
        prepared: true, mediaType: 'image', assetId: 'sticker-asset',
        assetVersionId: 'sticker-version', sourceUrl: '/project/sticker.png',
        archivePath: 'stickers/sticker.png', sha256: 'abc', size: 4,
        mimeType: 'image/png', start: 1, duration: 2, layer: 3,
        x: 75, y: 20, scale: 1.25, rotation: 15, opacity: 0.8,
      }],
    });
    expect(added).toMatchObject({
      ok: true, revision: 3,
      document: { project: { stickerSegments: [{
        id: 'sticker-1', assetId: 'sticker-asset', assetVersionId: 'sticker-version',
        start: 1, duration: 2, layer: 3, x: 75, y: 20, scale: 1.25,
        rotation: 15, opacity: 0.8,
      }] } },
    });
    if (!added.ok) throw new Error('sticker add should succeed');

    const updated = executeVideoEditorCommandPlan(added.document, {
      schemaVersion: 1, baseRevision: 3,
      operations: [{
        id: 'sticker-update-1', type: 'sticker.update', clipId: 'sticker-1',
        patch: { start: 1.5, duration: 1.5, x: 40, opacity: 0.5,
          keyframes: [{ time: 0, x: 40 }, { time: 1.5, x: 70, opacity: 1 }] },
      }],
    });
    expect(updated).toMatchObject({
      ok: true, revision: 4,
      document: { project: { stickerSegments: [{
        id: 'sticker-1', assetVersionId: 'sticker-version', start: 1.5,
        duration: 1.5, x: 40, opacity: 0.5,
        keyframes: [{ time: 0, x: 40 }, { time: 1.5, x: 70, opacity: 1 }],
      }] } },
    });
    if (!updated.ok) throw new Error('sticker update should succeed');

    const removed = executeVideoEditorCommandPlan(updated.document, {
      schemaVersion: 1, baseRevision: 4,
      operations: [{ id: 'sticker-remove-1', type: 'sticker.remove', clipId: 'sticker-1' }],
    });
    expect(removed).toMatchObject({ ok: true, revision: 5,
      document: { project: { stickerSegments: [] } } });
  });

  it('rejects unprepared and out-of-bounds Sticker data atomically', () => {
    const source = archive();
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1, baseRevision: 2,
      operations: [{
        id: 'sticker-forged', type: 'sticker.add', clipId: 'sticker-1',
        prepared: false, mediaType: 'image', start: 0, duration: 2,
        scale: 50,
      }],
    });
    expect(result).toMatchObject({ ok: false, operationId: 'sticker-forged' });
    expect(source.project).not.toHaveProperty('stickerSegments');
  });

  it('sets a bounded BGM envelope and speech ducking configuration', () => {
    const source = archive() as any;
    source.project.musicSegments = [{ id: 'music-1', start: 0, duration: 8, volume: 0.5 }];
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1, baseRevision: 2,
      operations: [{
        id: 'music-auto-1', type: 'music.automation.set', clipId: 'music-1',
        envelope: [{ time: 0, gain: 0.25 }, { time: 2, gain: 1 }, { time: 8, gain: 0.5 }],
        ducking: { enabled: true, speechBus: 'voiceover', threshold: 0.05,
          floorGain: 0.2, attackMs: 5, releaseMs: 300 },
      }],
    });

    expect(result).toMatchObject({
      ok: true, revision: 3,
      document: { project: { musicSegments: [{
        id: 'music-1',
        volumeEnvelope: [{ time: 0, gain: 0.25 }, { time: 2, gain: 1 }, { time: 8, gain: 0.5 }],
        ducking: { enabled: true, speechBus: 'voiceover', threshold: 0.05,
          floorGain: 0.2, attackMs: 5, releaseMs: 300 },
      }] } },
    });
  });

  it.each([
    [[{ time: 2, gain: 1 }, { time: 1, gain: 0.5 }], 'envelope'],
    [[{ time: 0, gain: 5 }], 'envelope'],
  ])('rejects invalid BGM %s data atomically', (envelope) => {
    const source = archive() as any;
    source.project.musicSegments = [{ id: 'music-1', start: 0, duration: 8 }];
    const result = executeVideoEditorCommandPlan(source, {
      schemaVersion: 1, baseRevision: 2,
      operations: [{ id: 'music-invalid', type: 'music.automation.set', clipId: 'music-1', envelope }],
    });
    expect(result).toMatchObject({ ok: false, operationId: 'music-invalid' });
    expect(source.project.musicSegments[0]).not.toHaveProperty('volumeEnvelope');
  });
});

/**
 * 剪二期: the Agent grades and filters deterministically.
 *
 * The workbench's colour panel and filter picker already persisted this state
 * and the headless planner already rendered it; what was missing was a
 * reducer, so an Agent could only reach it through the visible UI. These pin
 * the shapes: a grade merges into what the clip has, unknown fields and
 * out-of-range values are refused rather than clamped, a neutral result
 * leaves the clip clean, and a filter must be one the export honours.
 */
/**
 * 剪五期: the render's loudness target is a command. The planner normalised to
 * `project.targetLoudnessLufs` (default -14) and nothing could set it.
 */
describe('audio.set_loudness', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loose = any;
  const run = (operations: Array<Record<string, unknown>>, document: Loose = archive()) =>
    executeVideoEditorCommandPlan(document, { schemaVersion: 1, baseRevision: 2, operations } as never);

  it('sets a target inside the planner\'s range, reports it in the diff, and resets with null', () => {
    const set = run([{ id: 'l1', type: 'audio.set_loudness', targetLoudnessLufs: -16 }]);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect((set.document as Loose).project.targetLoudnessLufs).toBe(-16);
    expect(set.changes.projectFields).toEqual([{ field: 'targetLoudnessLufs', before: null, after: -16 }]);
    const reset = run([{ id: 'l2', type: 'audio.set_loudness', targetLoudnessLufs: null }], {
      ...set.document,
      project: { ...(set.document as Loose).project, commandState: { schemaVersion: 1, revision: 2, appliedOperationIds: [] } },
    });
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect((reset.document as Loose).project).not.toHaveProperty('targetLoudnessLufs');
    expect(reset.changes.projectFields).toEqual([{ field: 'targetLoudnessLufs', before: -16, after: null }]);
  });

  it('refuses a target outside -24…-6 or not a number', () => {
    for (const value of [-30, -3, 'loud', Number.NaN]) {
      const result = run([{ id: 'bad', type: 'audio.set_loudness', targetLoudnessLufs: value }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVALID_ARGUMENT');
    }
  });
});

describe('color.set and filter.set', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loose = any;
  function run(operations: Array<Record<string, unknown>>, document: Loose = archive()) {
    return executeVideoEditorCommandPlan(document, { schemaVersion: 1, baseRevision: 2, operations } as never);
  }
  const rewound = (result: { document: Loose }): Loose => ({
    ...result.document,
    project: { ...result.document.project, commandState: { schemaVersion: 1, revision: 2, appliedOperationIds: [] } },
  });

  it('merges a partial grade into the clip and reports the change in the diff', () => {
    const result = run([{ id: 'cool-1', type: 'color.set', clipId: 'visual-1', colorGrade: { temperature: -20, shadows: { luminance: -8 } } }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const clip = (result.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!;
    expect(clip.colorGrade).toEqual({
      temperature: -20, tint: 0, saturation: 0,
      shadows: { hue: 0, saturation: 0, luminance: -8 },
      midtones: { hue: 0, saturation: 0, luminance: 0 },
      highlights: { hue: 0, saturation: 0, luminance: 0 },
      offset: { hue: 0, saturation: 0, luminance: 0 },
    });
    expect(result.changes.tracks.visuals).toMatchObject({ modified: [{ id: 'visual-1', fields: ['colorGrade'] }] });

    // A second merge keeps what the first set.
    const again = run(
      [{ id: 'warm-2', type: 'color.set', clipId: 'visual-1', colorGrade: { highlights: { hue: 30, saturation: 12 } } }],
      rewound(result),
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const merged = (again.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!.colorGrade as Record<string, unknown>;
    expect(merged).toMatchObject({ temperature: -20, shadows: { luminance: -8 }, highlights: { hue: 30, saturation: 12 } });
  });

  it('replaces instead of merging when told to, and a neutral result leaves the clip clean', () => {
    const document: Loose = archive();
    document.project.visualSegments[0].colorGrade = { temperature: 40 };
    const replaced = run([{ id: 'r', type: 'color.set', clipId: 'visual-1', mode: 'replace', colorGrade: { tint: 5 } }], document);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect((replaced.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!.colorGrade).toMatchObject({ temperature: 0, tint: 5 });

    const reset = run([{ id: 'x', type: 'color.set', clipId: 'visual-1', reset: true }], document);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect((reset.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!).not.toHaveProperty('colorGrade');

    const neutral = run([{ id: 'n', type: 'color.set', clipId: 'visual-1', mode: 'replace', colorGrade: { temperature: 0 } }], document);
    expect(neutral.ok).toBe(true);
    if (!neutral.ok) return;
    expect((neutral.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!).not.toHaveProperty('colorGrade');
  });

  it('refuses what the grade cannot hold instead of clamping it quietly', () => {
    expect(run([{ id: 'a', type: 'color.set', clipId: 'visual-1', colorGrade: { temperature: 120 } }])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', operationId: 'a' });
    expect(run([{ id: 'b', type: 'color.set', clipId: 'visual-1', colorGrade: { exposure: 1 } }])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(run([{ id: 'c', type: 'color.set', clipId: 'visual-1', colorGrade: { shadows: { saturation: -1 } } }])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(run([{ id: 'd', type: 'color.set', clipId: 'visual-1', colorGrade: 'cool' }])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(run([{ id: 'e', type: 'color.set', clipId: 'nope', colorGrade: { tint: 1 } }])).toMatchObject({ ok: false, code: 'CLIP_NOT_FOUND' });
  });

  it('grades an overlay too, but not a caption', () => {
    const document: Loose = archive();
    document.project.visualOverlaySegments = [{ id: 'ov-1', type: 'image', start: 0, duration: 2 }];
    document.project.captionSegments = [{ id: 'cap-1', text: 'hi', start: 0, end: 1 }];
    const overlay = run([{ id: 'o', type: 'color.set', clipId: 'ov-1', colorGrade: { saturation: 10 } }], document);
    expect(overlay.ok).toBe(true);
    expect(run([{ id: 'p', type: 'color.set', clipId: 'cap-1', colorGrade: { saturation: 10 } }], document)).toMatchObject({ ok: false, code: 'UNSUPPORTED_TRACK' });
  });

  it('sets a clip filter, lifts it back to the project default, and sets the project default', () => {
    const set = run([{ id: 'f1', type: 'filter.set', clipId: 'visual-1', filterId: 'effect-cinematic' }]);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect((set.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!.filterId).toBe('effect-cinematic');
    expect(set.changes.tracks.visuals).toMatchObject({ modified: [{ id: 'visual-1', fields: ['filterId'] }] });

    const lifted = run(
      [{ id: 'f2', type: 'filter.set', clipId: 'visual-1', filterId: null }],
      rewound(set),
    );
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect((lifted.document.project as { visualSegments: Array<Record<string, unknown>> }).visualSegments[0]!).not.toHaveProperty('filterId');

    const project = run([{ id: 'f3', type: 'filter.set', filterId: 'film' }]);
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    expect((project.document.project as { selectedFilterId?: string }).selectedFilterId).toBe('film');
    expect(project.changes.projectFields).toEqual([{ field: 'selectedFilterId', before: null, after: 'film' }]);
  });

  it('refuses a filter the export would not honour, naming the ones it would', () => {
    const result = run([{ id: 'f', type: 'filter.set', clipId: 'visual-1', filterId: 'instagram-valencia' }]);
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_FILTER', operationId: 'f' });
    if (result.ok) return;
    expect(result.message).toContain('effect-cinematic');
    expect(run([{ id: 'g', type: 'filter.set', filterId: null }])).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });
});

/**
 * 剪三期: a clip knows which shot it stands for, and a shot can be dropped.
 * `asset.import` keeps a `director` record on the placed visual, a slot
 * replacement keeps it, and `clip.delete` reaches the visual and overlay tracks.
 */
describe('shots on the cut', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loose = any;
  const prepared = (clipId: string, extra: Record<string, unknown> = {}) => ({
    id: `import-${clipId}`, type: 'asset.import', clipId, track: 'visuals', prepared: true, mediaType: 'video',
    assetId: 'canvas-file:canvas/uploads/seq.mp4', assetVersionId: 'canvas-file:canvas/uploads/seq.mp4',
    sourceUrl: '/api/projects/p/raw/canvas/uploads/seq.mp4', name: '第 1 镜', duration: 3.5, sha256: 'abc', size: 10,
    mimeType: 'video/mp4', archivePath: 'canvas/uploads/seq.mp4', ...extra,
  });
  const run = (operations: Array<Record<string, unknown>>, document: Loose = archive()) =>
    executeVideoEditorCommandPlan(document, { schemaVersion: 1, baseRevision: 2, operations } as never);

  it('keeps the director record on a placed clip, and through a slot replacement', () => {
    const director = { shotId: 'shot-a', cameraId: 'cam_1', sourceIn: 0, sourceOut: 2, index: 0 };
    const placed = run([prepared('shot-a', { director }), { id: 'trim', type: 'visual.trim', clipId: 'shot-a', sourceIn: 0, sourceOut: 2 }]);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const clips: Loose[] = (placed.document.project as Loose).visualSegments;
    expect(clips.at(-1)).toMatchObject({ id: 'shot-a', director, duration: 2, sourceStart: 0, sourceDuration: 2 });

    const replaced = run(
      [prepared('shot-a-v2', { replaceClipId: 'shot-a', archivePath: 'canvas/renders/take.mp4', duration: 9 })],
      { ...placed.document, project: { ...(placed.document.project as Loose), commandState: { schemaVersion: 1, revision: 2, appliedOperationIds: [] } } },
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const slot: Loose = (replaced.document.project as Loose).visualSegments.at(-1);
    // Same slot, same length, same shot — only the file and the id changed.
    expect(slot).toMatchObject({ id: 'shot-a-v2', duration: 2, director, integrity: { archivePath: 'canvas/renders/take.mp4' } });
  });

  it('deletes a visual or overlay clip, and still refuses a track it does not know', () => {
    const document: Loose = archive();
    document.project.visualOverlaySegments = [{ id: 'ov-1', type: 'image', start: 0, duration: 2 }];
    const gone = run([
      { id: 'd1', type: 'clip.delete', track: 'visual', clipId: 'visual-1' },
      { id: 'd2', type: 'clip.delete', track: 'overlay', clipId: 'ov-1' },
    ], document);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect((gone.document.project as Loose).visualSegments).toEqual([]);
    expect((gone.document.project as Loose).visualOverlaySegments).toEqual([]);
    expect(gone.changes.tracks.visuals).toMatchObject({ removed: ['visual-1'] });
    expect(run([{ id: 'd3', type: 'clip.delete', track: 'sticker', clipId: 'x' }])).toMatchObject({ ok: false, code: 'UNSUPPORTED_TRACK' });
    expect(run([{ id: 'd4', type: 'clip.delete', track: 'visual', clipId: 'nope' }])).toMatchObject({ ok: false, code: 'CLIP_NOT_FOUND' });
  });
});


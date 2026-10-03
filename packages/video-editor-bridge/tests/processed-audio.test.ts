import { describe, it, expect, vi } from 'vitest';
import { executeVideoEditorCommandPlan, type JsonObject } from '../src/index.js';
import { startProcessedMedia } from '../../../vendor/ai-video-editor/src/lib/processedMediaCapability.js';

const old = {
  id: 'voice',
  assetId: 'old',
  assetVersionId: 'old-v1',
  sourceUrl: '/old.wav',
  start: 7,
  duration: 2,
  sourceStart: 3,
  sourceDuration: 4,
  playbackRate: 2,
  volume: 0,
  muted: true,
  fadeIn: 0.1,
  name: 'original',
};
const original = () => ({
  format: 'timeline-studio-archive',
  version: 3,
  project: {
    commandState: { schemaVersion: 1, revision: 2, appliedOperationIds: [] },
    audioSegments: [structuredClone(old)],
    musicSegments: [{ id: 'existing-music', start: 0, duration: 40, volume: 0 }],
    captionSegments: [{ id: 'c', text: 'manual', audioSegmentId: 'voice', start: 7, end: 9 }],
    visualSegments: [{ id: 'video', type: 'video', duration: 12 }],
    sourceAudioSource: {
      assetId: 'source',
      assetVersionId: 'source-v1',
      sourceUrl: '/source.wav',
      sourceKind: 'audio',
    },
    sourceAudioName: 'source',
    sourceAudioDuration: 12,
    sourceAudioStart: 0,
    sourceAudioVolume: 0,
  },
});
const output = (extra: Record<string, unknown> = {}) => ({
  id: 'place',
  type: 'asset.import',
  prepared: true,
  track: 'audio',
  clipId: 'voice',
  replaceClipId: 'voice',
  duration: 12,
  mediaType: 'audio',
  assetId: 'new',
  assetVersionId: 'new-v1',
  sourceUrl: '/new.wav',
  sha256: 'abc',
  archivePath: 'new.wav',
  mimeType: 'audio/wav',
  ...extra,
});
const document = (result: ReturnType<typeof executeVideoEditorCommandPlan>) => {
  if (!result.ok) throw new Error(result.message);
  return result.document;
};
const apply = (doc: object, operations: object[], baseRevision = 2) =>
  executeVideoEditorCommandPlan(doc as JsonObject, { schemaVersion: 1, baseRevision, operations } as never);

describe('durable processed audio', () => {
  it('replaces media identity while retaining slot links, mute, zero gain and original version across serialization', () => {
    const before = original();
    const result = apply(before, [output({ preserveOriginal: true })]);
    expect(result.ok).toBe(true);
    const project = JSON.parse(JSON.stringify(document(result))).project;
    expect(project.audioSegments[0]).toMatchObject({
      id: 'voice',
      assetVersionId: 'new-v1',
      sourceUrl: '/new.wav',
      start: 7,
      duration: 2,
      sourceStart: 3,
      playbackRate: 2,
      volume: 0,
      muted: true,
      voiceColorOriginal: old,
    });
    expect(project.captionSegments).toEqual(before.project.captionSegments);
    expect(project.musicSegments).toEqual(before.project.musicSegments);
    const restored = apply(
      document(result),
      [
        output({
          id: 'restore',
          assetId: 'old',
          assetVersionId: 'old-v1',
          sourceUrl: '/old.wav',
          restoreOriginal: true,
        }),
      ],
      3,
    );
    expect(restored.ok).toBe(true);
    expect((document(restored) as any).project.audioSegments[0]).toMatchObject({ ...old, voiceColorOriginal: null });
  });
  it('two stems commit together and append accompaniment without replacing existing music', () => {
    const before = original();
    const result = apply(before, [
      output({ track: 'source', replace: true, replaceClipId: undefined, clipId: 'stem' }),
      output({ id: 'instrumental', clipId: 'instrumental', replaceClipId: undefined }),
    ]);
    expect(result.ok).toBe(true);
    expect((document(result) as any).project.sourceAudioSource.assetVersionId).toBe('new-v1');
    expect((document(result) as any).project.audioSegments).toHaveLength(2);
    expect((document(result) as any).project.musicSegments).toEqual(before.project.musicSegments);
    const retry = apply(
      document(result),
      [
        output({ track: 'source', replace: true, replaceClipId: undefined, clipId: 'stem' }),
        output({ id: 'instrumental', clipId: 'instrumental', replaceClipId: undefined }),
      ],
      3,
    );
    expect((document(retry) as any).project.audioSegments).toHaveLength(2);
  });
  it('a failed second stem and locked tracks leave the input unchanged', () => {
    const before = original(),
      frozen = structuredClone(before);
    expect(
      apply(before, [
        output({ preserveOriginal: true }),
        output({ id: 'bad', clipId: 'missing', replaceClipId: 'missing' }),
      ]).ok,
    ).toBe(false);
    expect(before).toEqual(frozen);
    const locked = { ...before, project: { ...before.project, trackLocks: { audio: true } } };
    expect(apply(locked, [output()])).toMatchObject({ ok: false, code: 'TRACK_LOCKED' });
  });
  it('does not restore an arbitrary version or invent an original identity', () => {
    expect(apply(original(), [output({ restoreOriginal: true })])).toMatchObject({
      ok: false,
      code: 'ORIGINAL_VERSION_MISMATCH',
    });
    const before = original();
    before.project.audioSegments[0]!.assetVersionId = '';
    expect(apply(before, [output({ preserveOriginal: true })])).toMatchObject({
      ok: false,
      code: 'ORIGINAL_VERSION_REQUIRED',
    });
  });
  it('source replacement requires explicit intent and survives a round trip with its original', () => {
    expect(apply(original(), [output({ track: 'source' })])).toMatchObject({ ok: false, code: 'REPLACEMENT_REQUIRED' });
    const result = apply(original(), [output({ track: 'source', replace: true, preserveOriginal: true })]);
    expect(result.ok).toBe(true);
    const serialized = JSON.parse(JSON.stringify(document(result)));
    expect(serialized.project.sourceAudioSource).toMatchObject({
      assetVersionId: 'new-v1',
      original: { assetVersionId: 'source-v1' },
    });
    expect(serialized.project.sourceAudioVolume).toBe(0);
  });
});

describe('processing task lifecycle', () => {
  const runtime = () => ({
    captureTimeline: vi.fn(async () => 8),
    start: vi.fn(async () => ({ taskId: 't', signal: new AbortController().signal })),
    cancel: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    progress: vi.fn(async () => {}),
    complete: vi.fn(async () => ({
      taskId: 't',
      assets: [
        {
          assetId: 'a',
          versionId: 'v',
          url: '/saved.wav',
          kind: 'audio' as const,
          name: 'sound',
          mimeType: 'audio/wav',
        },
      ],
    })),
  });
  it('freezes revision at start and does not claim an unsaved result', async () => {
    const r = runtime();
    const op = await startProcessedMedia(r, { capability: 'voice-conversion', title: 'converted' });
    expect(op.request.parameters.timelineRevision).toBe(8);
    r.complete.mockRejectedValueOnce(new Error('disk full'));
    await expect(op.complete([{ blob: new Blob(['sound']) }])).rejects.toThrow('disk full');
  });
  it('keeps renderer-only cyclic state out of task JSON without changing the processing source', async () => {
    const r = runtime();
    const source = {
      ...old,
      speedCurve: { enabled: true, points: [{ progress: 0, rate: 1 }, { progress: 1, rate: 2 }] },
      rendererState: {} as Record<string, unknown>,
    };
    source.rendererState.self = source;
    const op = await startProcessedMedia(r, { capability: 'audio-extraction', title: 'extract', source: source as never });
    expect(() => JSON.stringify(op.request.parameters)).not.toThrow();
    expect(op.request.parameters.source).toMatchObject({ id: 'voice', assetVersionId: 'old-v1', volume: 0, muted: true });
    expect(op.request.parameters.timelineRevision).toBe(8);
    expect(source.rendererState.self).toBe(source);
    expect(source.speedCurve.points[1]?.rate).toBe(2);
    source.start = 90;
    expect((op.request.parameters.source as JsonObject).start).toBe(7);
  });
  it('cancellation after inference blocks result saving; durable completion remains a fact', async () => {
    const r = runtime(),
      controller = new AbortController();
    const op = await startProcessedMedia(r, {
      capability: 'vocal-separation',
      title: 'stems',
      signal: controller.signal,
    });
    controller.abort();
    await expect(op.complete([{ blob: new Blob(['sound']) }])).rejects.toThrow();
    expect(r.complete).not.toHaveBeenCalled();
    const c2 = new AbortController();
    const op2 = await startProcessedMedia(r, { capability: 'voice-conversion', title: 'voice', signal: c2.signal });
    r.complete.mockImplementationOnce(async () => {
      c2.abort();
      return {
        taskId: 't',
        assets: [
          {
            assetId: 'a',
            versionId: 'v',
            url: '/saved.wav',
            kind: 'audio' as const,
            name: 'sound',
            mimeType: 'audio/wav',
          },
        ],
      };
    });
    expect(await op2.complete([{ blob: new Blob(['sound']) }])).toMatchObject([
      { assetVersionId: 'v', sourceUrl: '/saved.wav' },
    ]);
  });
});

it('protects a locked audio sublane and preserves a moved clip lane on restoring its voice', () => {
  const before = original();
  Object.assign(before.project, { trackLocks: { 'audio-0': true } });
  expect(apply(before, [output()])).toMatchObject({ ok: false, code: 'TRACK_LOCKED' });
  const converted = apply(original(), [output({ preserveOriginal: true })]);
  const moved: any = JSON.parse(JSON.stringify(document(converted)));
  moved.project.audioSegments[0].lane = 2;
  moved.project.audioSegments[0].fadeIn = 0.4;
  const restored = apply(
    moved,
    [
      output({
        id: 'restore-moved',
        assetId: 'old',
        assetVersionId: 'old-v1',
        sourceUrl: '/old.wav',
        restoreOriginal: true,
      }),
    ],
    3,
  );
  expect((document(restored) as any).project.audioSegments[0]).toMatchObject({
    lane: 2,
    fadeIn: 0.4,
    assetVersionId: 'old-v1',
  });
});

it('does not replace a different clip’s ASR or a reviewed caption in an overlapping range', () => {
  const before = original();
  Object.assign(before.project, {
    captionSegments: [
      { id: 'other', text: 'other source', start: 7, end: 8, source: { kind: 'asr', clipId: 'other-audio' } },
      { id: 'target', text: 'old', start: 8, end: 9, source: { kind: 'asr', clipId: 'voice' } },
    ],
  });
  const result = apply(before, [
    {
      id: 'captions',
      type: 'caption.replace_ranges',
      sourceClipIds: ['voice'],
      ranges: [{ start: 7, end: 9 }],
      segments: [{ id: 'new', text: 'recognized', start: 8, end: 9, source: { kind: 'asr', clipId: 'voice' } }],
    },
  ]);
  expect(result.ok).toBe(true);
  expect((document(result) as any).project.captionSegments.map((c: any) => c.id)).toEqual(['other', 'new']);
});

it('rejects ASR replacement and row reflow that would change a locked caption row', () => {
  const before = original();
  Object.assign(before.project, {
    trackLocks: { 'caption-0': true },
    captionSegments: [{ id: 'old-asr', text: 'old', start: 7, end: 9, source: { kind: 'asr', clipId: 'voice' } }],
  });
  const copy = structuredClone(before);
  expect(
    apply(before, [
      {
        id: 'locked-captions',
        type: 'caption.replace_ranges',
        sourceClipIds: ['voice'],
        ranges: [{ start: 7, end: 9 }],
        segments: [{ id: 'new-asr', text: 'new', start: 7, end: 9, source: { kind: 'asr', clipId: 'voice' } }],
      },
    ]),
  ).toMatchObject({ ok: false, code: 'TRACK_LOCKED' });
  expect(before).toEqual(copy);
});

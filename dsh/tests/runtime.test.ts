import { describe, expect, it, vi } from 'vitest';

import type { CommandPlanBody, UploadedFile } from '../src/api.ts';
import { createCapabilityRuntime, fileExtension, fileStem } from '../src/runtime.ts';
import type { RuntimeHost } from '../src/runtime.ts';

function fakeHost(overrides: Partial<RuntimeHost> = {}) {
  const uploads: Array<{ path: string; type: string; unique: boolean | undefined }> = [];
  const commands: CommandPlanBody[] = [];
  const host: RuntimeHost = {
    uploadFile: async (path, blob, options) => {
      uploads.push({ path, type: blob.type, unique: options.unique });
      return { name: path, size: blob.size, mime: blob.type } satisfies UploadedFile;
    },
    importWorkspaceFile: async path => ({ name: `canvas/media/${path.split('/').pop()}`, size: 3, mime: 'video/mp4' }),
    executeCommands: async (body) => { commands.push(body); return {}; },
    projectRawUrl: path => `/api/projects/film-1/raw/${path}`,
    prepareTimeline: async () => 7,
    onTimelineChanged: vi.fn(async () => {}),
    onAssetsChanged: vi.fn(async () => {}),
    ...overrides,
  };
  return { host, uploads, commands };
}

describe('file names', () => {
  it('keeps a placeable extension and otherwise takes the content type\'s', () => {
    expect(fileExtension('雨夜.wav', 'audio/wav')).toBe('wav');
    expect(fileExtension('voice', 'audio/wav')).toBe('wav');
    expect(fileExtension('take.bin', 'video/mp4')).toBe('mp4');
    expect(() => fileExtension('a.txt', 'text/plain')).toThrow('不能保存');
  });

  it('cleans a stem but keeps what it says', () => {
    // A full-width colon is fine on Windows; the ASCII characters it refuses are not.
    expect(fileStem('推门而入：雨夜?.wav', 'voice')).toBe('推门而入：雨夜-');
    expect(fileStem('a:b|c.wav', 'voice')).toBe('a-b-c');
    expect(fileStem('../..', 'voice')).toBe('voice');
    expect(fileStem(undefined, 'tts')).toBe('tts');
  });
});

describe('capability runtime', () => {
  it('keeps an imported file in the film once, however often it is asked for', async () => {
    const { host, uploads } = fakeHost();
    const runtime = createCapabilityRuntime(host);
    const blob = new Blob(['img'], { type: 'image/png' });
    const [first, second] = await Promise.all([
      runtime.pinSourceAsset!({ localAssetId: 'l1', kind: 'image', name: '参考图.png', blob }),
      runtime.pinSourceAsset!({ localAssetId: 'l1', kind: 'image', name: '参考图.png', blob }),
    ]);
    expect(first).toBe(second);
    expect(uploads).toEqual([{ path: 'canvas/media/参考图.png', type: 'image/png', unique: true }]);
    expect(first).toMatchObject({ assetId: 'canvas-file:canvas/media/参考图.png', versionId: 'canvas-file:canvas/media/参考图.png', kind: 'image', url: '/api/projects/film-1/raw/canvas/media/参考图.png' });
    expect(host.onAssetsChanged).toHaveBeenCalledTimes(1);
  });

  it('copies a workspace media file into the film on first use', async () => {
    const { host } = fakeHost();
    const runtime = createCapabilityRuntime(host);
    const asset = await runtime.pinProjectFile!({ localAssetId: 'x', projectFileId: 'workspace:media/take.mp4', path: 'media/take.mp4', kind: 'video', name: 'take.mp4' });
    expect(asset).toMatchObject({ versionId: 'canvas-file:canvas/media/take.mp4', kind: 'video' });
  });

  it('saves generated files and places them through one command plan', async () => {
    const { host, uploads, commands } = fakeHost();
    const runtime = createCapabilityRuntime(host);
    const task = await runtime.start({ schemaVersion: 1, requestId: 'r1', capability: 'tts', title: '配音', outputKind: 'audio' });
    const completion = await runtime.complete(task.taskId, { schemaVersion: 1, requestId: 'r1', capability: 'tts', title: '配音', outputKind: 'audio' }, {
      files: [
        { blob: new Blob(['a'], { type: 'audio/wav' }), fileName: '第一句-01.wav', title: '第一句', placement: { track: 'audio', start: 1, duration: 2 } },
        { blob: new Blob(['b'], { type: 'audio/wav' }), fileName: '第二句-02.wav', title: '第二句', placement: { track: 'audio', start: 3, duration: 2, clipId: 'v2' } },
      ],
    });
    expect(uploads.map(upload => upload.path)).toEqual(['canvas/media/第一句-01.wav', 'canvas/media/第二句-02.wav']);
    expect(completion.assets?.map(asset => asset.name)).toEqual(['第一句', '第二句']);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ operationId: `place:${task.taskId}`, capabilityTask: { taskId: task.taskId }, plan: { baseRevision: 7 } });
    expect(commands[0]!.plan.operations).toEqual([
      { id: `place:${task.taskId}:1`, type: 'asset.place_version', clipId: 'generated:canvas-file:canvas/media/第一句-01.wav', assetId: 'canvas-file:canvas/media/第一句-01.wav', versionId: 'canvas-file:canvas/media/第一句-01.wav', track: 'audio', name: '第一句', start: 1, duration: 2 },
      { id: `place:${task.taskId}:2`, type: 'asset.place_version', clipId: 'v2', assetId: 'canvas-file:canvas/media/第二句-02.wav', versionId: 'canvas-file:canvas/media/第二句-02.wav', track: 'audio', name: '第二句', start: 3, duration: 2 },
    ]);
    expect(host.onTimelineChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the revision a capability pinned, so a cut edited meanwhile is refused', async () => {
    const { host, commands } = fakeHost();
    const runtime = createCapabilityRuntime(host);
    const request = { schemaVersion: 1 as const, requestId: 'r2', capability: 'repair' as const, title: '修复', outputKind: 'video' as const, parameters: { timelineRevision: 3 } };
    const task = await runtime.start(request);
    await runtime.complete(task.taskId, request, { blob: new Blob(['v'], { type: 'video/mp4' }), fileName: 'repair.mp4', placement: { track: 'visuals', replaceClipId: 'c1' } });
    expect(commands[0]!.plan.baseRevision).toBe(3);
  });

  it('records an analysis with its artifacts and does not place it', async () => {
    const { host, commands } = fakeHost();
    const runtime = createCapabilityRuntime(host);
    const request = { schemaVersion: 1 as const, requestId: 'r3', capability: 'depth' as const, title: '景深', outputKind: 'image' as const };
    const task = await runtime.start(request);
    const completion = await runtime.complete(task.taskId, request, {
      files: [{ blob: new Blob(['d'], { type: 'image/png' }), fileName: 'depth.png', analysisRole: 'depth-map' }],
      analysisResult: {
        analysisId: 'a1', analysisKind: 'depth',
        source: { assetId: 's', versionId: 's', clipId: 'c', mediaType: 'video', sourceStart: 0, sourceDuration: 1 },
        model: { id: 'm', revision: '1' }, width: 2, height: 2, frameRate: 1, temporalMapping: { start: 0, duration: 1, sampleCount: 1 },
      },
    });
    expect(commands).toHaveLength(0);
    expect(completion.documentResult).toMatchObject({ kind: 'video-analysis-record', analysisId: 'a1' });
    expect((completion.documentResult as { artifacts: Array<{ role: string; sha256: string }> }).artifacts[0]).toMatchObject({ role: 'depth-map' });
    expect((completion.documentResult as { artifacts: Array<{ sha256: string }> }).artifacts[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aborts a cancelled task and refuses to complete it', async () => {
    const { host } = fakeHost();
    const runtime = createCapabilityRuntime(host);
    const request = { schemaVersion: 1 as const, requestId: 'r4', capability: 'tts' as const, title: 't' };
    const task = await runtime.start(request);
    await runtime.cancel(task.taskId);
    expect(task.signal.aborted).toBe(true);
    await expect(runtime.complete(task.taskId, request, { documentResult: {} })).rejects.toThrow('已经结束');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { startAutoEditCapability } from '../../../vendor/ai-video-editor/src/lib/autoEditCapability.js';
import { generateFrameCaptions } from '../../../vendor/ai-video-editor/src/lib/autoEdit.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import autoEditHookSource from '../../../vendor/ai-video-editor/src/hooks/useAutoEdit.js?raw';

describe('fork-first auto-edit capability', () => {
  it('uses host frame descriptions without requiring Chrome LanguageModel', async () => {
    const describeFrames = vi.fn(async (frames) => frames.map((_frame: unknown, index: number) => `画面 ${index + 1}`));
    const frames = [
      { segmentId: 'visual-1', segmentIndex: 0, segmentName: 'Clip', segmentStart: 0, segmentEnd: 4, time: 0, blob: new Blob(['a']) },
      { segmentId: 'visual-1', segmentIndex: 0, segmentName: 'Clip', segmentStart: 0, segmentEnd: 4, time: 2, blob: new Blob(['b']) },
    ];

    const captions = await generateFrameCaptions({
      frames,
      duration: 4,
      language: 'zh',
      describeFrames,
    });

    expect(describeFrames).toHaveBeenCalledTimes(1);
    expect(captions.map((caption) => caption.text)).toEqual(['画面 1', '画面 2']);
    expect(captions.every((caption) => caption.visualSegmentId === 'visual-1')).toBe(true);
  });

  it('keeps the upstream evidence algorithms and injects the VibeDev task runtime', () => {
    expect(autoEditHookSource).toContain('extractAutoEditFrames');
    expect(autoEditHookSource).toContain('generateFrameCaptions');
    expect(autoEditHookSource).toContain('startAutoEditCapability');
    expect(autoEditHookSource).toContain('capabilityRuntime.describeFrames({');
    expect(autoEditHookSource).toContain('await response.blob()');
    expect(appSource).toMatch(/useAutoEdit\(\{[\s\S]*?capabilityRuntime: hostBridge\?\.capabilityRuntime/);
  });

  it('reports bounded evidence through one durable auto-edit task', async () => {
    const hostController = new AbortController();
    const editorController = new AbortController();
    const runtime = {
      start: vi.fn(async () => ({ taskId: 'task-auto-edit', signal: hostController.signal })),
      progress: vi.fn(async () => undefined),
      complete: vi.fn(async (_taskId, _request, output) => ({
        taskId: 'task-auto-edit', documentResult: output.documentResult,
      })),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const session = await startAutoEditCapability({
      capabilityRuntime: runtime,
      language: 'zh',
      segmentCount: 2,
      signal: editorController.signal,
    });

    await session?.progress({ progress: 63, phase: 'captioning' });
    await session?.complete({
      durationSeconds: 8,
      candidates: [{ segmentId: 'visual-1', time: 1.2, difference: 0.48, aspectRatio: '16:9', url: 'blob:private' }],
      captions: [{ id: 'caption-1', text: '你好', start: 1, end: 2, visualSegmentId: 'visual-1' }],
      segments: [{ id: 'visual-1', index: 0, status: 'done', error: '' }],
    });

    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({ capability: 'auto-edit' }));
    expect(runtime.progress).toHaveBeenCalledWith('task-auto-edit', { progress: 63, phase: 'captioning' });
    expect(runtime.complete).toHaveBeenCalledWith(
      'task-auto-edit',
      expect.objectContaining({ capability: 'auto-edit' }),
      { documentResult: {
        kind: 'auto-edit-review',
        schemaVersion: 1,
        algorithm: 'fork-first',
        language: 'zh',
        durationSeconds: 8,
        segmentCount: 2,
        candidateCount: 1,
        captionCount: 1,
        candidates: [{ segmentId: 'visual-1', time: 1.2, difference: 0.48, aspectRatio: '16:9' }],
        captions: [{ id: 'caption-1', text: '你好', start: 1, end: 2, visualSegmentId: 'visual-1' }],
        segments: [{ id: 'visual-1', index: 0, status: 'done', error: '' }],
        qualityScore: {
          score: 50,
          grade: 'D',
          dimensions: { segmentCoverage: 0.5, captionCoverage: 0.5, evidenceCoverage: 0.5 },
        },
      } },
    );
  });

  it('scores incomplete fork evidence without leaking frame blob URLs', async () => {
    const runtime = {
      start: vi.fn(async () => ({ taskId: 'task-score', signal: new AbortController().signal })),
      progress: vi.fn(async () => undefined),
      complete: vi.fn(async (_taskId, _request, output) => output),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const session = await startAutoEditCapability({
      capabilityRuntime: runtime, language: 'zh', segmentCount: 2,
    });
    await session?.complete({
      durationSeconds: 8,
      candidates: [{ segmentId: 'visual-1', time: 1, difference: 0.2, url: 'blob:secret' }],
      captions: [],
      segments: [
        { id: 'visual-1', index: 0, status: 'done', error: '' },
        { id: 'visual-2', index: 1, status: 'empty', error: '' },
      ],
    });
    expect(runtime.complete.mock.calls[0]?.[2].documentResult).toMatchObject({
      qualityScore: {
        score: 33,
        grade: 'F',
        dimensions: { segmentCoverage: 0.5, captionCoverage: 0, evidenceCoverage: 0.5 },
      },
    });
    expect(JSON.stringify(runtime.complete.mock.calls[0]?.[2])).not.toContain('blob:secret');
  });

  it('cancels the same host task when the editor run is canceled', async () => {
    const editorController = new AbortController();
    const runtime = {
      start: vi.fn(async () => ({ taskId: 'task-auto-edit', signal: new AbortController().signal })),
      progress: vi.fn(async () => undefined), complete: vi.fn(), fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const session = await startAutoEditCapability({
      capabilityRuntime: runtime, language: 'zh', segmentCount: 1, signal: editorController.signal,
    });
    editorController.abort(new DOMException('Canceled', 'AbortError'));
    await vi.waitFor(() => expect(runtime.cancel).toHaveBeenCalledWith('task-auto-edit'));
    expect(session?.signal.aborted).toBe(true);
  });
});

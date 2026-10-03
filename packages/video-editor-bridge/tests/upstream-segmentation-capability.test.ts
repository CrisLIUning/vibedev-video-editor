import { describe, expect, it, vi } from 'vitest';

import type { VideoEditorCapabilityRuntime } from '../src/host-contract.js';
import { startSegmentationCapability } from '../../../vendor/ai-video-editor/src/lib/segmentationCapability.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useVisionAnalysis.js?raw';
import personRuntimeSource from '../../../vendor/ai-video-editor/src/lib/personOutlineAnalysis.js?raw';
import magicTouchWorkerSource from '../../../vendor/ai-video-editor/src/workers/magic-touch.worker.js?raw';
import slimSamWorkerSource from '../../../vendor/ai-video-editor/src/workers/slimsam.worker.js?raw';
import workerSource from '../../../vendor/ai-video-editor/src/workers/nanodet.worker.js?raw';

function runtime(): VideoEditorCapabilityRuntime {
  return {
    prepareModel: vi.fn(async ({ modelId, onProgress }) => {
      onProgress?.({ progress: 50, phase: 'downloading:magic-touch' });
      if (modelId === 'slimsam-77-uniform') {
        return {
          modelId,
          revision: 'revision-slimsam',
          artifacts: {
            config: '/api/models/slimsam/config',
            preprocessor: '/api/models/slimsam/preprocessor',
            'vision-fp16': '/api/models/slimsam/vision-fp16',
            'prompt-fp16': '/api/models/slimsam/prompt-fp16',
            'mediapipe-selfie': '/api/models/slimsam/mediapipe-selfie',
          },
        };
      }
      return {
        modelId: 'object-segmentation-v1',
        revision: 'revision-1',
        artifacts: {
          nanodet: '/api/models/nanodet',
          'magic-touch': '/api/models/magic-touch',
        },
      };
    }),
    start: vi.fn(async () => ({ taskId: 'task-segmentation', signal: new AbortController().signal })),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async (_taskId, _request, output) => ({
      taskId: 'task-segmentation',
      documentResult: output.documentResult,
    })),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

describe('upstream segmentation capability bridge', () => {
  it('pins an editor-local source before starting the host task or preparing models', async () => {
    const capabilityRuntime = Object.assign(runtime(), {
      pinSourceAsset: vi.fn(async () => ({
        assetId: 'asset-pinned', versionId: 'version-pinned', kind: 'video' as const,
        name: 'local.mp4', url: '/media/local.mp4', mimeType: 'video/mp4',
      })),
    });
    const sourceBlob = new Blob(['video'], { type: 'video/mp4' });

    const session = await startSegmentationCapability({
      capabilityRuntime,
      title: 'Person segmentation',
      modelIds: ['slimsam-77-uniform'],
      source: {
        assetId: 'local-video-1', versionId: '', clipId: 'clip-local',
        mediaType: 'video', sourceStart: 0, sourceDuration: 4,
        localAssetId: 'local-video-1', name: 'local.mp4', blob: sourceBlob,
      },
    });

    expect(capabilityRuntime.pinSourceAsset).toHaveBeenCalledWith({
      localAssetId: 'local-video-1', kind: 'video', name: 'local.mp4', blob: sourceBlob,
    });
    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      inputVersionIds: ['version-pinned'],
      parameters: expect.objectContaining({ sourceAssetId: 'asset-pinned', sourceClipId: 'clip-local' }),
    }));
    expect(session?.source).toMatchObject({
      assetId: 'asset-pinned', versionId: 'version-pinned', clipId: 'clip-local',
    });
    expect(capabilityRuntime.pinSourceAsset.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(capabilityRuntime.start).mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a stale local source before starting a host task or model download', async () => {
    const capabilityRuntime = runtime();

    await expect(startSegmentationCapability({
      capabilityRuntime,
      title: 'Person segmentation',
      source: {
        assetId: 'local-video-1', versionId: '', clipId: 'clip-local',
        mediaType: 'video', sourceStart: 0, sourceDuration: 4,
      },
    })).rejects.toThrow('added again before analysis');

    expect(capabilityRuntime.start).not.toHaveBeenCalled();
    expect(capabilityRuntime.prepareModel).not.toHaveBeenCalled();
  });

  it('does not create a host task when analysis is canceled while its source is being pinned', async () => {
    const local = new AbortController();
    let resolvePin!: (asset: any) => void;
    const capabilityRuntime = Object.assign(runtime(), {
      pinSourceAsset: vi.fn(() => new Promise((resolve) => { resolvePin = resolve; })),
    });
    const pending = startSegmentationCapability({
      capabilityRuntime,
      title: 'Person segmentation',
      signal: local.signal,
      source: {
        assetId: 'local-video-1', versionId: '', clipId: 'clip-local',
        mediaType: 'video', sourceStart: 0, sourceDuration: 4,
        localAssetId: 'local-video-1', name: 'local.mp4',
        blob: new Blob(['video'], { type: 'video/mp4' }),
      },
    });
    await vi.waitFor(() => expect(capabilityRuntime.pinSourceAsset).toHaveBeenCalled());
    local.abort(new DOMException('canceled', 'AbortError'));
    resolvePin({
      assetId: 'asset-pinned', versionId: 'version-pinned', kind: 'video',
      name: 'local.mp4', url: '/media/local.mp4', mimeType: 'video/mp4',
    });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capabilityRuntime.start).not.toHaveBeenCalled();
    expect(capabilityRuntime.prepareModel).not.toHaveBeenCalled();
  });

  it('prepares verified host models and persists a bounded analysis result', async () => {
    const capabilityRuntime = runtime();
    const session = await startSegmentationCapability({
      capabilityRuntime,
      title: 'Object segmentation',
      source: {
        assetId: 'asset-source',
        versionId: 'version-source',
        clipId: 'clip-source',
        mediaType: 'video',
        sourceStart: 1,
        sourceDuration: 4,
      },
    });

    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'segmentation', outputKind: 'video',
      inputVersionIds: ['version-source'],
      parameters: expect.objectContaining({
        sourceAssetId: 'asset-source',
        sourceClipId: 'clip-source',
      }),
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'object-segmentation-v1', signal: session?.signal,
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'slimsam-77-uniform', signal: session?.signal,
    }));
    expect(session?.modelArtifacts).toEqual(expect.objectContaining({
      nanodet: '/api/models/nanodet',
      'magic-touch': '/api/models/magic-touch',
      config: '/api/models/slimsam/config',
      'vision-fp16': '/api/models/slimsam/vision-fp16',
      'mediapipe-selfie': '/api/models/slimsam/mediapipe-selfie',
    }));
    const mask = new Blob(['mask'], { type: 'video/webm' });
    const analysisResult = {
      analysisId: 'analysis-1',
      analysisKind: 'object' as const,
      source: {
        assetId: 'asset-source',
        versionId: 'version-source',
        clipId: 'clip-source',
        mediaType: 'video' as const,
        sourceStart: 1,
        sourceDuration: 4,
      },
      model: { id: 'object-segmentation-v1', revision: 'revision-1' },
      width: 320,
      height: 180,
      frameRate: 8,
      temporalMapping: { start: 0, duration: 4, sampleCount: 12 },
    };
    await session?.complete({
      files: [{ blob: mask, fileName: 'object-mask.webm', analysisRole: 'object-mask' }],
      analysisResult,
    });
    expect(capabilityRuntime.complete).toHaveBeenCalledWith(
      'task-segmentation',
      expect.objectContaining({ capability: 'segmentation' }),
      {
        files: [{ blob: mask, fileName: 'object-mask.webm', analysisRole: 'object-mask' }],
        analysisResult,
      },
    );
  });

  it('cancels the host task when the local editor aborts during model preparation', async () => {
    const local = new AbortController();
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.prepareModel!).mockImplementation(async ({ signal }) => (
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('canceled', 'AbortError')), { once: true });
      })
    ));

    const pending = startSegmentationCapability({
      capabilityRuntime,
      title: 'Object segmentation',
      signal: local.signal,
    });
    await vi.waitFor(() => expect(capabilityRuntime.prepareModel).toHaveBeenCalled());
    local.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capabilityRuntime.cancel).toHaveBeenCalledWith('task-segmentation');
  });

  it('keeps cancellation wired while the host completion request is in flight', async () => {
    const local = new AbortController();
    const capabilityRuntime = runtime();
    let resolveComplete!: (value: { taskId: string }) => void;
    vi.mocked(capabilityRuntime.complete).mockImplementation(() => new Promise((resolve) => {
      resolveComplete = resolve;
    }));
    const session = await startSegmentationCapability({
      capabilityRuntime,
      title: 'Object segmentation',
      signal: local.signal,
    });

    const completing = session!.complete({ pipeline: 'object-outline', sampleCount: 12 });
    await vi.waitFor(() => expect(capabilityRuntime.complete).toHaveBeenCalledTimes(1));
    local.abort(new DOMException('superseded', 'AbortError'));
    await vi.waitFor(() => expect(capabilityRuntime.cancel).toHaveBeenCalledWith('task-segmentation'));
    resolveComplete({ taskId: 'task-segmentation' });

    await expect(completing).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('marks the host task failed when completion cannot be committed', async () => {
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.complete).mockRejectedValue(new Error('complete request failed'));
    const session = await startSegmentationCapability({
      capabilityRuntime,
      title: 'Object segmentation',
    });

    await expect(session!.complete({ pipeline: 'object-outline', sampleCount: 12 }))
      .rejects.toThrow('complete request failed');
    expect(capabilityRuntime.fail).toHaveBeenCalledWith('task-segmentation', {
      code: 'VIDEO_EDITOR_SEGMENTATION_COMPLETE_FAILED',
      message: 'complete request failed',
    });
  });

  it('wires the host runtime into both segmentation and face-swap hooks', () => {
    const calls = [...appSource.matchAll(/use(?:VisionAnalysis|FaceSwapGeneration)\(\{([\s\S]*?)\n\s*\}\);/g)];
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call[1]).toContain('capabilityRuntime: hostBridge?.capabilityRuntime');

    expect(hookSource).toContain('startSegmentationCapability');
    expect(hookSource).toContain('configureObjectSegmentationModels');
    expect(hookSource).toContain('configurePersonSegmentationModels');
    expect(hookSource).toContain('segmentationSession.complete(capabilityOutput)');
    expect(hookSource).toContain('source: segmentationSession.source');
    expect(hookSource).toContain('deps.onSourcePinned?.(requestedSource.localAssetId, segmentationSession.source)');
    expect(appSource.match(/onSourcePinned: applyPinnedAssetIdentity/g)).toHaveLength(4);
    expect(hookSource.indexOf('segmentationSession.complete(capabilityOutput)')).toBeLessThan(
      hookSource.lastIndexOf('deps.setVisionRecords'),
    );
    expect(hookSource).toContain('createSegmentationCapabilityOutput');
    expect(hookSource).toContain('encodeAnalysisMaskFrames');
    expect(hookSource).toContain('segmentationSession.signal.addEventListener');

    expect(workerSource).toContain('message.type === "configure"');
    expect(workerSource).toContain('hostModelUrl');
    expect(magicTouchWorkerSource).toMatch(/hostModelUrl\r?\n\s*\?\s*\[hostModelUrl\]/);
    expect(personRuntimeSource).toContain('modelArtifacts: slimSamModelArtifacts');
    expect(personRuntimeSource).toContain('configureMediaPipePersonSegmenterModel(next?.["mediapipe-selfie"] || null)');
    expect(slimSamWorkerSource).toContain('configureHostModelFiles');
    expect(slimSamWorkerSource).toContain('env.useCustomCache = true');
    expect(slimSamWorkerSource).toContain('env.allowLocalModels = true');
  });
});

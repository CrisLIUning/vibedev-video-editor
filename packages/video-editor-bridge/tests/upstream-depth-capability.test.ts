import { describe, expect, it, vi } from 'vitest';

import type { VideoEditorCapabilityRuntime } from '../src/host-contract.js';
import { startDepthCapability } from '../../../vendor/ai-video-editor/src/lib/depthCapability.js';
import { createDepthCapabilityOutput } from '../../../vendor/ai-video-editor/src/lib/depthArtifacts.js';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useDepthOfFieldAnalysis.js?raw';
import workerSource from '../../../vendor/ai-video-editor/src/workers/depth-anything.worker.js?raw';

function runtime(): VideoEditorCapabilityRuntime {
  return {
    prepareModel: vi.fn(async () => ({
      modelId: 'depth-anything-v2-small', revision: 'depth-revision',
      artifacts: {
        config: '/api/models/depth/config',
        preprocessor: '/api/models/depth/preprocessor',
        'model-q4f16': '/api/models/depth/model-q4f16',
      },
    })),
    start: vi.fn(async () => ({ taskId: 'task-depth', signal: new AbortController().signal })),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async (_taskId, _request, output) => ({
      taskId: 'task-depth', documentResult: output.analysisResult,
    })),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

const source = {
  assetId: 'asset-source', versionId: 'version-source', clipId: 'visual-1',
  mediaType: 'video' as const, sourceStart: 0, sourceDuration: 4,
};

describe('upstream depth capability bridge', () => {
  it('pins an editor-local source before starting depth analysis', async () => {
    const capabilityRuntime = Object.assign(runtime(), {
      pinSourceAsset: vi.fn(async () => ({
        assetId: 'asset-pinned', versionId: 'version-pinned', kind: 'video' as const,
        name: 'local.mp4', url: '/media/local.mp4', mimeType: 'video/mp4',
      })),
    });
    const sourceBlob = new Blob(['video'], { type: 'video/mp4' });

    const session = await startDepthCapability({
      capabilityRuntime,
      title: 'Depth',
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
  });

  it('rejects a stale local source before starting the depth task or model download', async () => {
    const capabilityRuntime = runtime();

    await expect(startDepthCapability({
      capabilityRuntime,
      title: 'Depth',
      source: {
        assetId: 'local-video-1', versionId: '', clipId: 'clip-local',
        mediaType: 'video', sourceStart: 0, sourceDuration: 4,
      },
    })).rejects.toThrow('added again before analysis');

    expect(capabilityRuntime.start).not.toHaveBeenCalled();
    expect(capabilityRuntime.prepareModel).not.toHaveBeenCalled();
  });

  it('does not create a depth task when canceled while its source is being pinned', async () => {
    const local = new AbortController();
    let resolvePin!: (asset: any) => void;
    const capabilityRuntime = Object.assign(runtime(), {
      pinSourceAsset: vi.fn(() => new Promise((resolve) => { resolvePin = resolve; })),
    });
    const pending = startDepthCapability({
      capabilityRuntime,
      title: 'Depth',
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

  it('prepares the pinned host model and binds the task to its source AssetVersion', async () => {
    const capabilityRuntime = runtime();
    const session = await startDepthCapability({ capabilityRuntime, title: 'Depth', source });

    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'depth', inputVersionIds: ['version-source'],
      parameters: expect.objectContaining({ sourceAssetId: 'asset-source', sourceClipId: 'visual-1' }),
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'depth-anything-v2-small', signal: session?.signal,
    }));
    expect(session?.modelArtifacts).toEqual(expect.objectContaining({
      config: '/api/models/depth/config', 'model-q4f16': '/api/models/depth/model-q4f16',
    }));
    expect(session?.model).toEqual({ id: 'depth-anything-v2-small', revision: 'depth-revision' });
  });

  it('encodes temporal depth maps as an immutable analysis asset', async () => {
    const first = new Blob(['one'], { type: 'image/png' });
    const second = new Blob(['two'], { type: 'image/png' });
    const encoded = new Blob(['video'], { type: 'video/webm' });
    const encodeFrames = vi.fn(async () => encoded);
    const output = await createDepthCapabilityOutput({
      analysis: { duration: 4, fps: 8, sourceSize: { width: 320, height: 180 }, samples: [
        { time: 0, depthBlob: first }, { time: 2, depthBlob: second },
      ] },
      source,
      model: { id: 'depth-anything-v2-small', revision: 'depth-revision' },
      encodeFrames,
    });

    expect(encodeFrames).toHaveBeenCalledWith([first, second], 320, 180, 8, [0, 2], 4, expect.any(Object));
    expect(output.files[0]).toEqual(expect.objectContaining({
      blob: encoded, analysisRole: 'depth-map', mimeType: 'video/webm',
    }));
    expect(output.analysisResult).toEqual(expect.objectContaining({
      analysisKind: 'depth', source,
      temporalMapping: { start: 0, duration: 4, sampleCount: 2 },
    }));
  });

  it('uses only host-provided model artifacts and returns durable results to the hook', () => {
    expect(workerSource).toContain('configureHostModelFiles');
    expect(workerSource).toContain('env.useCustomCache = true');
    expect(workerSource).toContain('env.allowLocalModels = true');
    expect(workerSource).toContain('env.allowRemoteModels = false');
    expect(hookSource).toContain('startDepthCapability');
    expect(hookSource).toContain('createDepthCapabilityOutput');
    expect(hookSource).toContain('depthSession.complete');
    expect(hookSource).toContain('source: depthSession.source');
    expect(hookSource).toContain('onSourcePinned?.(requestedSource.localAssetId, depthSession.source)');
    expect(hookSource.indexOf('depthSession.complete')).toBeLessThan(hookSource.lastIndexOf('setDepthRecords'));
  });
});

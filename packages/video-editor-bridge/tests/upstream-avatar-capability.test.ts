import { describe, expect, it, vi } from 'vitest';

import type { VideoEditorCapabilityRuntime } from '../src/host-contract.js';
import { startAvatarCapability } from '../../../vendor/ai-video-editor/src/lib/avatarCapability.js';
import { runAvatarWorkerTask } from '../../../vendor/ai-video-editor/src/lib/editorRuntime.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useAvatarGeneration.js?raw';
import joyVasaWorkerSource from '../../../vendor/ai-video-editor/src/workers/joyvasa.worker.js?raw';
import livePortraitWorkerSource from '../../../vendor/ai-video-editor/src/workers/liveportrait.worker.js?raw';

function runtime(): VideoEditorCapabilityRuntime {
  return {
    prepareModel: vi.fn(async ({ modelId, onProgress }) => {
      onProgress?.({ progress: 50, phase: 'downloading:audio-aa' });
      return {
        modelId,
        revision: `revision-${modelId}`,
        artifacts: { [`artifact-${modelId}`]: `/api/models/${modelId}/artifact` },
      };
    }),
    start: vi.fn(async () => ({ taskId: 'task-avatar', signal: new AbortController().signal })),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async (_taskId, _request, output) => ({
      taskId: 'task-avatar',
      asset: {
        assetId: 'asset-avatar',
        versionId: 'version-avatar',
        kind: 'video' as const,
        name: output.fileName || 'avatar.webm',
        url: '/api/projects/project/files/avatar.webm',
        mimeType: output.mimeType || 'video/webm',
      },
    })),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

describe('upstream avatar capability bridge', () => {
  it('persists a generated avatar and replaces the selected visual through the shared placement command', async () => {
    const capabilityRuntime = runtime();
    const local = new AbortController();
    const session = await startAvatarCapability({
      capabilityRuntime,
      title: 'Talking avatar',
      signal: local.signal,
    });
    const blob = new Blob(['avatar'], { type: 'video/webm' });

    const completion = await session?.complete(blob, 'liveportrait-joyvasa.webm', {
      track: 'visuals',
      duration: 4,
      replaceClipId: 'visual-1',
      width: 512,
      height: 512,
    });

    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'avatar',
      outputKind: 'video',
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledTimes(3);
    expect(capabilityRuntime.prepareModel).toHaveBeenNthCalledWith(1, expect.objectContaining({
      modelId: 'joyvasa-webgpu', signal: session?.signal,
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenNthCalledWith(2, expect.objectContaining({
      modelId: 'liveportrait-webgpu-common', signal: session?.signal,
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenNthCalledWith(3, expect.objectContaining({
      modelId: 'liveportrait-webgpu-preview', signal: session?.signal,
    }));
    expect(session?.modelArtifacts).toEqual({
      'artifact-joyvasa-webgpu': '/api/models/joyvasa-webgpu/artifact',
      'artifact-liveportrait-webgpu-common': '/api/models/liveportrait-webgpu-common/artifact',
      'artifact-liveportrait-webgpu-preview': '/api/models/liveportrait-webgpu-preview/artifact',
    });
    expect(capabilityRuntime.complete).toHaveBeenCalledWith(
      'task-avatar',
      expect.objectContaining({ capability: 'avatar' }),
      expect.objectContaining({
        blob,
        fileName: 'liveportrait-joyvasa.webm',
        placement: expect.objectContaining({ replaceClipId: 'visual-1' }),
      }),
    );
    expect(completion?.asset?.versionId).toBe('version-avatar');
  });

  it('downloads only the selected LivePortrait generator quality', async () => {
    const capabilityRuntime = runtime();
    await startAvatarCapability({
      capabilityRuntime,
      title: 'Quality avatar',
      quality: 'quality',
    });

    const preparedModelIds = vi.mocked(capabilityRuntime.prepareModel!).mock.calls
      .map(([request]) => request.modelId);
    expect(preparedModelIds).toEqual([
      'joyvasa-webgpu',
      'liveportrait-webgpu-common',
      'liveportrait-webgpu-quality',
    ]);
    expect(preparedModelIds).not.toContain('liveportrait-webgpu-preview');
  });

  it('cancels the host task when the editor-side run is aborted', async () => {
    const capabilityRuntime = runtime();
    const local = new AbortController();
    const session = await startAvatarCapability({
      capabilityRuntime,
      title: 'Talking avatar',
      signal: local.signal,
    });

    local.abort(new DOMException('canceled', 'AbortError'));

    await vi.waitFor(() => expect(capabilityRuntime.cancel).toHaveBeenCalledWith('task-avatar'));
    await expect(session?.progress({ progress: 50, phase: 'rendering' }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a pending avatar worker operation immediately when canceled', async () => {
    const controller = new AbortController();
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
    } as unknown as Worker;
    const pending = runAvatarWorkerTask(
      worker,
      { type: 'generate' },
      [],
      'videoFrames',
      undefined,
      { signal: controller.signal },
    );

    controller.abort(new DOMException('canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('wires the host runtime, durable completion and selected-clip replacement into the avatar hook', () => {
    expect(appSource).toMatch(/useAvatarGeneration\(\{[\s\S]*?capabilityRuntime: hostBridge\?\.capabilityRuntime/);
    expect(hookSource).toContain('startAvatarCapability');
    expect(hookSource).toContain('quality,');
    expect(hookSource).toContain('capabilitySession?.complete');
    expect(hookSource).toContain('replaceClipId: d.previewVisualSegment.id');
    expect(hookSource).toContain('completion?.asset');
    expect(hookSource).toContain('avatarMotionWorkerRef.current?.terminate()');
    expect(hookSource).toContain('avatarRenderWorkerRef.current?.terminate()');
    expect(hookSource).toContain('modelArtifacts: capabilitySession?.modelArtifacts');
    expect(joyVasaWorkerSource).toContain('hostModelArtifacts');
    expect(joyVasaWorkerSource).toContain('Host JoyVASA model returned HTTP');
    expect(hookSource).toContain('livePortraitModelArtifacts: capabilitySession?.modelArtifacts');
    expect(livePortraitWorkerSource).toContain('Host LivePortrait model returned HTTP');
    expect(livePortraitWorkerSource).toContain('lp-preview-aa');
    expect(livePortraitWorkerSource).toContain('lp-quality-aa');
    expect(livePortraitWorkerSource).toContain('modelHostArtifactCacheKey(file, hostModelArtifacts)');
    expect(livePortraitWorkerSource).toContain('downloadState.completed += LIVE_PORTRAIT_WEB_MODEL.knownArtifacts[key]?.bytes ?? 0');
  });
});

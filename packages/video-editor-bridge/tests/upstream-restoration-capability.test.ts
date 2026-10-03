import { describe, expect, it, vi } from 'vitest';

import type { VideoEditorCapabilityRuntime } from '../src/host-contract.js';
import { startRestorationCapability } from '../../../vendor/ai-video-editor/src/lib/restorationCapability.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useNanoVsrRestoration.js?raw';
import workerSource from '../../../vendor/ai-video-editor/src/workers/nanovsr.worker.js?raw';

function runtime(): VideoEditorCapabilityRuntime {
  return {
    prepareModel: vi.fn(async ({ onProgress }) => {
      onProgress?.({ progress: 50, phase: 'downloading:video' });
      return {
        modelId: 'nanovsr-644k',
        revision: 'revision-1',
        artifacts: { image: '/api/models/nanovsr-image', video: '/api/models/nanovsr-video' },
      };
    }),
    start: vi.fn(async () => ({ taskId: 'task-restoration', signal: new AbortController().signal })),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async () => ({
      taskId: 'task-restoration',
      asset: {
        assetId: 'asset-restored', versionId: 'version-restored', kind: 'image' as const,
        name: 'Restored', url: '/api/projects/project/raw/restored.png', mimeType: 'image/png',
      },
    })),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

describe('upstream restoration capability bridge', () => {
  it('uses verified host models and persists the accepted replacement', async () => {
    const capabilityRuntime = runtime();
    const session = await startRestorationCapability({
      capabilityRuntime,
      outputKind: 'image',
      title: 'Restore portrait',
    });

    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'restoration', outputKind: 'image',
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'nanovsr-644k', signal: session?.signal,
    }));
    expect(session?.modelArtifacts.image).toBe('/api/models/nanovsr-image');
    await session?.complete(
      new Blob(['png'], { type: 'image/png' }),
      'restored.png',
      { track: 'visuals', duration: 5, replaceClipId: 'clip-source', width: 1280, height: 720 },
    );
    expect(capabilityRuntime.complete).toHaveBeenCalledWith(
      'task-restoration',
      expect.objectContaining({ capability: 'restoration' }),
      expect.objectContaining({
        fileName: 'restored.png',
        placement: expect.objectContaining({ replaceClipId: 'clip-source', width: 1280, height: 720 }),
      }),
    );
  });

  it('wires restoration to the host task, cache, and worker model URL', () => {
    expect(appSource).toMatch(/useNanoVsrRestoration\(\{[\s\S]*?capabilityRuntime: hostBridge\?\.capabilityRuntime/);
    expect(hookSource).toContain('startRestorationCapability');
    expect(hookSource).toContain('modelArtifacts');
    expect(workerSource).toContain('hostModelUrl');
  });

  it('cancels model preparation when the editor aborts the restoration', async () => {
    const local = new AbortController();
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.prepareModel!).mockImplementation(async ({ signal }) => (
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('canceled', 'AbortError')), { once: true });
      })
    ));

    const pending = startRestorationCapability({
      capabilityRuntime,
      outputKind: 'video',
      title: 'Restore video',
      signal: local.signal,
    });
    await vi.waitFor(() => expect(capabilityRuntime.prepareModel).toHaveBeenCalled());
    local.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capabilityRuntime.cancel).toHaveBeenCalledWith('task-restoration');
    expect(capabilityRuntime.fail).not.toHaveBeenCalled();
  });

  it('cannot complete after the host cancels an accepted preview', async () => {
    const host = new AbortController();
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.start).mockResolvedValue({
      taskId: 'task-restoration', signal: host.signal,
    });
    const session = await startRestorationCapability({
      capabilityRuntime,
      outputKind: 'image',
      title: 'Restore image',
    });

    host.abort(new DOMException('host canceled', 'AbortError'));
    await expect(session?.complete(
      new Blob(['png'], { type: 'image/png' }),
      'restored.png',
      { track: 'visuals', duration: 5, replaceClipId: 'source' },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(capabilityRuntime.complete).not.toHaveBeenCalled();
  });

  it('rejects preview progress when the host cancels while the report is in flight', async () => {
    const host = new AbortController();
    const capabilityRuntime = runtime();
    let releaseProgress!: () => void;
    vi.mocked(capabilityRuntime.start).mockResolvedValue({
      taskId: 'task-restoration', signal: host.signal,
    });
    vi.mocked(capabilityRuntime.progress).mockImplementation(async (_taskId, update) => {
      if (update.progress === 99) {
        await new Promise<void>((resolve) => { releaseProgress = resolve; });
      }
    });
    const session = await startRestorationCapability({
      capabilityRuntime,
      outputKind: 'image',
      title: 'Restore image',
    });

    const pending = session!.progress({ progress: 99, phase: 'awaiting-apply' });
    await vi.waitFor(() => expect(releaseProgress).toBeTypeOf('function'));
    host.abort(new DOMException('host canceled', 'AbortError'));
    releaseProgress();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not report completion when the host cancels during persistence', async () => {
    const host = new AbortController();
    const capabilityRuntime = runtime();
    let releaseCompletion!: () => void;
    vi.mocked(capabilityRuntime.start).mockResolvedValue({
      taskId: 'task-restoration', signal: host.signal,
    });
    vi.mocked(capabilityRuntime.complete).mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseCompletion = resolve; });
      return {
        taskId: 'task-restoration',
        asset: {
          assetId: 'asset-restored', versionId: 'version-restored', kind: 'image' as const,
          name: 'Restored', url: '/restored.png', mimeType: 'image/png',
        },
      };
    });
    const session = await startRestorationCapability({
      capabilityRuntime,
      outputKind: 'image',
      title: 'Restore image',
    });

    const pending = session!.complete(
      new Blob(['png'], { type: 'image/png' }),
      'restored.png',
      { track: 'visuals', replaceClipId: 'source' },
    );
    await vi.waitFor(() => expect(releaseCompletion).toBeTypeOf('function'));
    host.abort(new DOMException('host canceled', 'AbortError'));
    releaseCompletion();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

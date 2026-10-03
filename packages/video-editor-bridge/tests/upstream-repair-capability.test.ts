import { describe, expect, it, vi } from 'vitest';

import type { VideoEditorCapabilityRuntime } from '../src/host-contract.js';
import { startRepairCapability } from '../../../vendor/ai-video-editor/src/lib/repairCapability.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import dialogSource from '../../../vendor/ai-video-editor/src/components/MiganRepairDialog.jsx?raw';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useMiganRepair.js?raw';
import librarySource from '../../../vendor/ai-video-editor/src/lib/miganRepair.js?raw';
import clipSource from '../../../vendor/ai-video-editor/src/lib/miganClipRepair.js?raw';
import workerSource from '../../../vendor/ai-video-editor/src/workers/miganRepair.worker.js?raw';

function runtime(): VideoEditorCapabilityRuntime {
  return {
    prepareModel: vi.fn(async () => ({
      modelId: 'migan-256-webgpu', revision: 'revision-1',
      artifacts: { weights: '/api/models/migan-weights' },
    })),
    start: vi.fn(async () => ({ taskId: 'task-repair', signal: new AbortController().signal })),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async () => ({
      taskId: 'task-repair',
      asset: {
        assetId: 'asset-repair', versionId: 'version-repair', kind: 'image' as const,
        name: 'Repaired', url: '/repaired.png', mimeType: 'image/png',
      },
    })),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

describe('upstream MI-GAN repair capability bridge', () => {
  it('prepares the verified host model and persists replacement through the shared runtime', async () => {
    const capabilityRuntime = runtime();
    const session = await startRepairCapability({
      capabilityRuntime, outputKind: 'image', title: 'Remove watermark',
    });

    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({ capability: 'repair' }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'migan-256-webgpu', signal: session?.signal,
    }));
    expect(session?.modelArtifacts.weights).toBe('/api/models/migan-weights');
    await session?.complete(new Blob(['png'], { type: 'image/png' }), 'repaired.png', {
      track: 'visuals', replaceClipId: 'source-clip', width: 1920, height: 1080,
    });
    expect(capabilityRuntime.complete).toHaveBeenCalledWith(
      'task-repair',
      expect.objectContaining({ capability: 'repair' }),
      expect.objectContaining({ placement: expect.objectContaining({ replaceClipId: 'source-clip' }) }),
    );
  });

  it('wires image and video MI-GAN work through the host task and model URL', () => {
    expect(appSource).toMatch(/useMiganRepair\(\{[\s\S]*?capabilityRuntime: hostBridge\?\.capabilityRuntime/);
    expect(hookSource).toContain('startRepairCapability');
    expect(hookSource).toContain('modelArtifacts');
    expect(librarySource).toContain('hostModelUrl');
    expect(clipSource).toContain('modelArtifacts');
    expect(workerSource).toContain('hostModelUrl');
    expect(dialogSource).toContain('await repair.applyVideoPreview()');
  });

  it('propagates editor cancellation to the host task during model preparation', async () => {
    const editor = new AbortController();
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.prepareModel!).mockImplementation(async ({ signal }) => (
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('canceled', 'AbortError')), { once: true });
      })
    ));

    const pending = startRepairCapability({
      capabilityRuntime, outputKind: 'video', title: 'Repair clip', signal: editor.signal,
    });
    await vi.waitFor(() => expect(capabilityRuntime.prepareModel).toHaveBeenCalled());
    editor.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capabilityRuntime.cancel).toHaveBeenCalledWith('task-repair');
  });
});

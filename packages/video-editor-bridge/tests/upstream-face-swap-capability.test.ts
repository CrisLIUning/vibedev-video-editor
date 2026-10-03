import { describe, expect, it, vi } from 'vitest';

import type { VideoEditorCapabilityRuntime } from '../src/host-contract.js';
import { startFaceSwapCapability } from '../../../vendor/ai-video-editor/src/lib/faceSwapCapability.js';

function runtime(): VideoEditorCapabilityRuntime {
  return {
    prepareModel: vi.fn(async ({ onProgress }) => {
      onProgress?.({ progress: 55, phase: 'downloading:identity' });
      return {
        modelId: 'mobilefaceswap-224',
        revision: 'revision-1',
        artifacts: {
          identity: '/api/models/identity',
          conditioner: '/api/models/conditioner',
          generator: '/api/models/generator',
          scrfd: '/api/models/scrfd',
        },
      };
    }),
    start: vi.fn(async () => ({ taskId: 'task-face', signal: new AbortController().signal })),
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async () => ({
      taskId: 'task-face',
      asset: {
        assetId: 'asset-face', versionId: 'version-face', kind: 'video' as const, name: 'Face swap',
        url: '/api/projects/project/raw/face-swap.webm', mimeType: 'video/webm',
      },
    })),
    fail: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

describe('upstream face-swap capability bridge', () => {
  it('prepares verified host models and persists the generated media', async () => {
    const capabilityRuntime = runtime();
    const session = await startFaceSwapCapability({
      capabilityRuntime,
      outputKind: 'video',
      title: 'Face swap',
    });

    expect(capabilityRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'face-swap', outputKind: 'video',
    }));
    expect(capabilityRuntime.prepareModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'mobilefaceswap-224', signal: session?.signal,
    }));
    expect(session?.modelArtifacts.scrfd).toBe('/api/models/scrfd');
    await session?.progress({ progress: 80, phase: 'frames' });
    const completed = await session?.complete(
      new Blob(['video'], { type: 'video/webm' }),
      'face.webm',
      { track: 'visuals', duration: 4 },
    );
    expect(capabilityRuntime.complete).toHaveBeenCalledWith(
      'task-face',
      expect.objectContaining({ capability: 'face-swap' }),
      expect.objectContaining({
        fileName: 'face.webm', mimeType: 'video/webm',
        placement: { track: 'visuals', duration: 4 },
      }),
    );
    expect(completed?.asset?.versionId).toBe('version-face');
  });

  it('fails the durable task when model preparation is rejected', async () => {
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.prepareModel!).mockRejectedValue(new Error('not authorized'));

    await expect(startFaceSwapCapability({ capabilityRuntime, outputKind: 'image', title: 'Swap' }))
      .rejects.toThrow('not authorized');
    expect(capabilityRuntime.fail).toHaveBeenCalledWith('task-face', {
      code: 'VIDEO_EDITOR_MODEL_PREPARE_FAILED', message: 'not authorized',
    });
  });

  it('cancels the durable task when the user declines model preparation', async () => {
    const capabilityRuntime = runtime();
    vi.mocked(capabilityRuntime.prepareModel!).mockRejectedValue(
      new DOMException('Model download was not authorized', 'AbortError'),
    );

    await expect(startFaceSwapCapability({ capabilityRuntime, outputKind: 'image', title: 'Swap' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(capabilityRuntime.cancel).toHaveBeenCalledWith('task-face');
    expect(capabilityRuntime.fail).not.toHaveBeenCalled();
  });
});

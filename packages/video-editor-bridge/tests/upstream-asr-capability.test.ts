import { describe, expect, it, vi } from 'vitest';

import { createInterruptibleAsrWorkerClient } from '../../../vendor/ai-video-editor/src/lib/asrWorkerClient.js';
import asrWorkerSource from '../../../vendor/ai-video-editor/src/workers/asr.worker.js?raw';

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

describe('upstream Whisper capability integration', () => {
  it('terminates inference and rejects with AbortError when the host cancels', async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const client = createInterruptibleAsrWorkerClient({
      createWorker: () => workers.shift() as unknown as Worker,
      createRequestId: () => 'asr-request',
    });
    const controller = new AbortController();

    const pending = client.transcribe(new Float32Array([0.1, 0.2]), {
      preferredLanguage: 'zh',
      signal: controller.signal,
      modelArtifacts: { config: '/api/media/video-editor-models/whisper-small-q8/artifacts/config' },
    });
    expect(firstWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelArtifacts: { config: '/api/media/video-editor-models/whisper-small-q8/artifacts/config' },
      }),
      expect.any(Array),
    );
    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

    const next = client.transcribe(new Float32Array([0.3]), { preferredLanguage: 'zh' });
    secondWorker.emit({
      type: 'result',
      requestId: 'asr-request',
      output: { text: '恢复成功' },
      language: 'zh',
      languageDetected: true,
      modelId: 'whisper-small',
    });
    await expect(next).resolves.toMatchObject({ language: 'zh' });
  });

  it('keeps hosted Whisper model loading inside the shared host cache', async () => {
    expect(asrWorkerSource).toContain('Host Whisper model is missing artifacts');
    expect(asrWorkerSource).toContain('Host Whisper model returned HTTP');
    expect(asrWorkerSource).toContain('env.useCustomCache = true');
    expect(asrWorkerSource).toContain('env.useBrowserCache = false');
    expect(asrWorkerSource).toContain('env.allowLocalModels = true');
    expect(asrWorkerSource).toContain('env.allowRemoteModels = false');
    expect(asrWorkerSource).toContain('encoder_model_quantized.onnx');
    expect(asrWorkerSource).toContain('decoder_model_merged_quantized.onnx');
  });

});

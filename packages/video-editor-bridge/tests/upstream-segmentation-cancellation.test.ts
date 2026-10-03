import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface PostedMessage { type?: string; requestId?: string; modelUrl?: string }

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: string;
  readonly posted: PostedMessage[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Array<(event: { data: unknown }) => void>>();

  constructor(url: URL | string) {
    this.url = String(url);
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: PostedMessage) {
    this.posted.push(message);
    if (this.url.includes('nanodet.worker') && message.type === 'configure') {
      queueMicrotask(() => this.emit('message', { requestId: message.requestId, type: 'configured' }));
    }
  }

  terminate() {
    this.terminated = true;
  }

  respond(data: unknown) {
    this.emit('message', data);
  }

  private emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.resetModules();
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('upstream segmentation physical cancellation', () => {
  it('terminates NanoDet inference instead of only discarding its promise', async () => {
    const runtime = await import('../../../vendor/ai-video-editor/src/lib/objectSegmentation.js');
    await runtime.configureObjectSegmentationModels({
      modelUrls: { nanodet: '/host/nanodet', 'magic-touch': '/host/magic-touch' },
    });
    const controller = new AbortController();
    const pending = runtime.detectObjectsWithNanoDet({
      blob: new Blob(['frame']),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted.some((item) => item.type === 'detect')).toBe(true));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it('terminates MagicTouch model preparation when canceled', async () => {
    const runtime = await import('../../../vendor/ai-video-editor/src/lib/objectSegmentation.js');
    await runtime.configureObjectSegmentationModels({
      modelUrls: { nanodet: '/host/nanodet', 'magic-touch': '/host/magic-touch' },
    });
    const controller = new AbortController();
    const pending = runtime.prepareObjectSegmenter({ signal: controller.signal });
    await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted[0]).toMatchObject({
      type: 'prepare',
      modelUrl: '/host/magic-touch',
    }));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it('sends a cloneable Blob to MagicTouch and restores its transferred mask', async () => {
    const runtime = await import('../../../vendor/ai-video-editor/src/lib/objectSegmentation.js');
    await runtime.configureObjectSegmentationModels({
      modelUrls: { nanodet: '/host/nanodet', 'magic-touch': '/host/magic-touch' },
    });
    const blob = new Blob(['frame'], { type: 'image/jpeg' });
    const pending = runtime.segmentObjectWithMagicTouch(blob, { x: 0.5, y: 0.5 });
    await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted[0]).toMatchObject({
      type: 'segment',
      modelUrl: '/host/magic-touch',
      blob,
    }));
    const requestId = FakeWorker.instances[0]!.posted[0]!.requestId;
    FakeWorker.instances[0]!.respond({
      requestId,
      type: 'result',
      result: {
        alpha: new Uint8ClampedArray([255]).buffer,
        maskWidth: 1,
        maskHeight: 1,
        width: 1,
        height: 1,
      },
    });

    await expect(pending).resolves.toMatchObject({
      alpha: new Uint8ClampedArray([255]),
      width: 1,
      height: 1,
    });
  });
});

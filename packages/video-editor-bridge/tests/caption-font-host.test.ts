import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureCaptionFontHostRuntime,
  ensureCaptionFontLoaded,
} from '../../../vendor/ai-video-editor/src/lib/captionFonts.js';

afterEach(() => {
  configureCaptionFontHostRuntime(null);
  vi.unstubAllGlobals();
});

describe('caption font host cache', () => {
  it('prepares and fetches a non-default font through the VibeDev host runtime', async () => {
    const prepareModel = vi.fn(async () => ({
      modelId: 'caption-font-inter',
      revision: 'pinned',
      artifacts: { font: '/api/media/video-editor-models/caption-font-inter/artifacts/font' },
    }));
    const add = vi.fn();
    const put = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([0, 1, 2]), { status: 200 }));
    class FontFaceStub {
      status = 'unloaded';
      constructor(
        readonly family: string,
        readonly source: string,
      ) {}
      async load() {
        this.status = 'loaded';
        return this;
      }
    }
    vi.stubGlobal('FontFace', FontFaceStub);
    vi.stubGlobal('fetch', fetchImpl);
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({ match: vi.fn(async () => null), put })),
    });
    vi.stubGlobal('document', {
      fonts: { add, check: vi.fn(() => true), load: vi.fn(async () => []) },
      querySelector: vi.fn(() => null),
      head: { append: vi.fn() },
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:verified-font') });
    configureCaptionFontHostRuntime({ prepareModel });

    await expect(ensureCaptionFontLoaded('inter', 'Hosted font')).resolves.toMatchObject({
      id: 'inter',
      family: 'Inter',
    });
    expect(prepareModel).toHaveBeenCalledWith({ modelId: 'caption-font-inter' });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/media/video-editor-models/caption-font-inter/artifacts/font',
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });
});

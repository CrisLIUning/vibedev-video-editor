import { describe, expect, it, vi } from 'vitest';

import { createSegmentationCapabilityOutput } from '../../../vendor/ai-video-editor/src/lib/segmentationArtifacts.js';

const source = {
  assetId: 'asset-source',
  versionId: 'version-source',
  clipId: 'clip-source',
  mediaType: 'video' as const,
  sourceStart: 2,
  sourceDuration: 4,
};

describe('segmentation analysis artifacts', () => {
  it('encodes temporal cutouts into an immutable mask video', async () => {
    const first = new Blob(['first'], { type: 'image/png' });
    const second = new Blob(['second'], { type: 'image/png' });
    const encoded = new Blob(['mask-video'], { type: 'video/webm' });
    const encodeMaskVideo = vi.fn(async () => encoded);

    const output = await createSegmentationCapabilityOutput({
      analysis: {
        duration: 4,
        sourceSize: { width: 320, height: 180 },
        samples: [
          { time: 0, cutoutBlob: first },
          { time: 2, cutoutBlob: second },
        ],
      },
      visualType: 'video',
      targetKind: 'object',
      source,
      model: { id: 'object-segmentation-v1', revision: 'revision-1' },
      encodeMaskVideo,
    });

    expect(encodeMaskVideo).toHaveBeenCalledWith(
      [first, second], 320, 180, 8, [0, 2], 4, expect.objectContaining({ signal: undefined }),
    );
    expect(output.files).toEqual([expect.objectContaining({
      blob: encoded,
      fileName: expect.stringMatching(/^object-mask-.+\.webm$/u),
      analysisRole: 'object-mask',
    })]);
    expect(output.analysisResult).toEqual(expect.objectContaining({
      analysisKind: 'object',
      source,
      model: { id: 'object-segmentation-v1', revision: 'revision-1' },
      width: 320,
      height: 180,
      frameRate: 8,
      temporalMapping: { start: 0, duration: 4, sampleCount: 2 },
    }));
  });

  it('persists a still cutout without encoding a video', async () => {
    const cutout = new Blob(['png'], { type: 'image/png' });
    const mask = new Blob(['mask'], { type: 'image/png' });
    const encodeStillMask = vi.fn(async () => mask);
    const output = await createSegmentationCapabilityOutput({
      analysis: { cutoutBlob: cutout, sourceSize: { width: 640, height: 360 } },
      visualType: 'image',
      targetKind: 'person',
      source: { ...source, mediaType: 'image', sourceStart: 0, sourceDuration: 3 },
      model: { id: 'slimsam-77-uniform', revision: 'revision-slimsam' },
      encodeStillMask,
    });

    expect(encodeStillMask).toHaveBeenCalledWith(cutout, 640, 360, { signal: undefined });
    expect(output.files[0]).toEqual(expect.objectContaining({
      blob: mask,
      analysisRole: 'subject-mask',
      mimeType: 'image/png',
    }));
    expect(output.analysisResult.analysisKind).toBe('subject');
  });

  it('rejects analysis without a pinned source version or persistent cutout', async () => {
    await expect(createSegmentationCapabilityOutput({
      analysis: { samples: [] },
      visualType: 'video',
      targetKind: 'object',
      source: { ...source, versionId: '' },
      model: { id: 'object-segmentation-v1', revision: 'revision-1' },
      encodeMaskVideo: vi.fn(),
    })).rejects.toThrow('pinned source AssetVersion');
  });
});

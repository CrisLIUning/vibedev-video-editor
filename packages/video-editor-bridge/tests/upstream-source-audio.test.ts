import { describe, expect, it, vi } from 'vitest';

import {
  loadSourceAudioBlob,
  resolveSourceAudioInputAsset,
} from '../../../vendor/ai-video-editor/src/lib/sourceAudioAsset.js';

describe('source audio extraction input', () => {
  const hostVideo = {
    id: 'vibedev-video-v1',
    assetId: 'video-1',
    assetVersionId: 'video-v1',
    versionId: 'video-v1',
    type: 'video',
    src: '/api/projects/project-1/raw/video.mp4',
    sourceUrl: '/api/projects/project-1/raw/video.mp4',
    hostAuthorized: true,
  };

  it('resolves a persisted Agent clip back to the exact authorized library asset', () => {
    expect(resolveSourceAudioInputAsset({
      assetId: 'video-1',
      assetVersionId: 'video-v1',
      type: 'video',
      sourceUrl: '/api/projects/project-1/raw/video.mp4',
    }, [hostVideo])).toBe(hostVideo);

    expect(resolveSourceAudioInputAsset({
      assetId: 'video-1',
      assetVersionId: 'forged',
      type: 'video',
      sourceUrl: '/api/projects/project-1/raw/video.mp4',
    }, [hostVideo])).toBeNull();

    expect(resolveSourceAudioInputAsset({
      assetId: 'forged-video',
      assetVersionId: 'forged-version',
      type: 'video',
      src: '/api/projects/project-1/raw/private.mp4',
      sourceUrl: '/api/projects/project-1/raw/private.mp4',
      hostAuthorized: true,
    }, [hostVideo])).toBeNull();
  });

  it('loads the authorized URL lazily while keeping uploaded blobs unchanged', async () => {
    const remoteBlob = new Blob(['video'], { type: 'video/mp4' });
    const loader = vi.fn(async () => remoteBlob);
    await expect(loadSourceAudioBlob({
      assetId: 'video-1',
      assetVersionId: 'video-v1',
      sourceUrl: hostVideo.sourceUrl,
      type: 'video',
    }, [hostVideo], loader)).resolves.toBe(remoteBlob);
    expect(loader).toHaveBeenCalledWith(hostVideo, expect.any(Function));

    const uploaded = new Blob(['upload'], { type: 'video/mp4' });
    await expect(loadSourceAudioBlob({ blob: uploaded }, [], loader)).resolves.toBe(uploaded);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

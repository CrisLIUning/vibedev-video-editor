import { describe, expect, it, vi } from 'vitest';

import {
  loadAuthorizedProjectMediaBlob,
  restoreAuthorizedAudioSegmentSource,
  restoreAuthorizedVisualSegmentSource,
  resolveAuthorizedProjectMediaSource,
} from '../../../vendor/ai-video-editor/src/lib/hostAuthorizedMedia.js';

const authorizedAssets = [{
  assetId: 'music-1',
  versionId: 'music-v1',
  kind: 'audio',
  name: 'Theme.wav',
  url: '/api/projects/project-1/raw/music/theme.wav',
  mimeType: 'audio/wav',
}];

describe('host-authorized project media', () => {
  it('resolves only an exact authorized URL and media kind', () => {
    expect(resolveAuthorizedProjectMediaSource(
      '/api/projects/project-1/raw/music/theme.wav',
      'audio',
      authorizedAssets,
    )).toMatchObject({ assetId: 'music-1', versionId: 'music-v1' });
    expect(resolveAuthorizedProjectMediaSource(
      '/api/projects/project-1/raw/music/other.wav',
      'audio',
      authorizedAssets,
    )).toBeNull();
    expect(resolveAuthorizedProjectMediaSource(
      '/api/projects/project-1/raw/music/theme.wav',
      'video',
      authorizedAssets,
    )).toBeNull();
  });

  it('does not issue a request for an unlisted project URL', async () => {
    const fetchImpl = vi.fn();

    await expect(loadAuthorizedProjectMediaBlob(
      '/api/projects/project-2/raw/private.wav',
      'audio',
      authorizedAssets,
      fetchImpl,
    )).rejects.toThrow('project-media-not-authorized');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('loads the bytes only after authorization and rejects failed responses', async () => {
    const blob = new Blob(['music'], { type: 'audio/wav' });
    const fetchImpl = vi.fn(async () => new Response(blob, { status: 200 }));

    await expect(loadAuthorizedProjectMediaBlob(
      '/api/projects/project-1/raw/music/theme.wav',
      'audio',
      authorizedAssets,
      fetchImpl,
    )).resolves.toEqual(blob);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/projects/project-1/raw/music/theme.wav',
      { credentials: 'same-origin' },
    );

    const failingFetch = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadAuthorizedProjectMediaBlob(
      '/api/projects/project-1/raw/music/theme.wav',
      'audio',
      authorizedAssets,
      failingFetch,
    )).rejects.toThrow('project-media-load-failed:404');
  });

  it('restores remote audio segments only from their declared authorized media kind', () => {
    const videoAsset = {
      assetId: 'clip-1',
      versionId: 'clip-v1',
      kind: 'video',
      url: '/api/projects/project-1/raw/clips/one.mp4',
    };

    expect(restoreAuthorizedAudioSegmentSource({
      id: 'voice-1',
      sourceUrl: '/api/projects/project-1/raw/music/theme.wav',
    }, authorizedAssets)).toMatchObject({
      id: 'voice-1',
      url: '/api/projects/project-1/raw/music/theme.wav',
      peaks: [],
    });
    expect(restoreAuthorizedAudioSegmentSource({
      id: 'linked-1',
      sourceKind: 'video',
      sourceUrl: '/api/projects/project-1/raw/clips/one.mp4',
    }, [...authorizedAssets, videoAsset])).toMatchObject({
      id: 'linked-1',
      url: '/api/projects/project-1/raw/clips/one.mp4',
    });
    expect(() => restoreAuthorizedAudioSegmentSource({
      id: 'forged',
      sourceUrl: 'https://example.com/private.wav',
    }, authorizedAssets)).toThrow('project-media-not-authorized');
  });

  it('restores a persisted visual only when URL and AssetVersion identity match', () => {
    const imageAsset = {
      assetId: 'image-1',
      versionId: 'image-v1',
      kind: 'image',
      url: '/api/projects/project-1/raw/images/one.png',
    };
    const segment = {
      id: 'visual-1',
      type: 'image',
      assetId: 'image-1',
      assetVersionId: 'image-v1',
      sourceUrl: imageAsset.url,
    };

    expect(restoreAuthorizedVisualSegmentSource(segment, [imageAsset])).toMatchObject({
      ...segment,
      src: imageAsset.url,
    });
    expect(() => restoreAuthorizedVisualSegmentSource({
      ...segment,
      assetVersionId: 'forged-version',
    }, [imageAsset])).toThrow('project-media-version-mismatch');
  });

  it('replaces a stale blob URL with the current host-authorized AssetVersion URL', () => {
    const videoAsset = {
      assetId: 'video-1',
      versionId: 'video-v2',
      kind: 'video',
      url: '/api/projects/project-1/raw/video/current.mp4',
    };

    expect(restoreAuthorizedVisualSegmentSource({
      id: 'visual-1',
      type: 'video',
      assetId: 'video-1',
      assetVersionId: 'video-v2',
      sourceUrl: '/api/projects/project-1/raw/video/expired.mp4',
      src: 'blob:https://vibedev.invalid/stale-preview',
    }, [videoAsset])).toMatchObject({
      assetId: 'video-1',
      assetVersionId: 'video-v2',
      sourceUrl: videoAsset.url,
      src: videoAsset.url,
    });
  });
});

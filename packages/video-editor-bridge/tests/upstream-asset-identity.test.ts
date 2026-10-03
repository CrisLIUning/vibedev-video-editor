import { describe, expect, it } from 'vitest';

import {
  authorizedAssetToUserAsset,
  hostVersionIdOf,
  mergeAuthorizedUserAssets,
  mergeProjectFileUserAssets,
  withHostIdentity,
} from '../../../vendor/ai-video-editor/src/lib/hostAuthorizedMedia.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import aiMusicSource from '../../../vendor/ai-video-editor/src/hooks/useAiMusicGeneration.js?raw';
import assetDropSource from '../../../vendor/ai-video-editor/src/lib/assetDropActions.js?raw';
import avatarSource from '../../../vendor/ai-video-editor/src/hooks/useAvatarGeneration.js?raw';
import faceSwapSource from '../../../vendor/ai-video-editor/src/hooks/useFaceSwapGeneration.js?raw';
import fileUploadSource from '../../../vendor/ai-video-editor/src/hooks/useFileUpload.js?raw';
import miganSource from '../../../vendor/ai-video-editor/src/hooks/useMiganRepair.js?raw';
import nanoVsrSource from '../../../vendor/ai-video-editor/src/hooks/useNanoVsrRestoration.js?raw';
import voiceCapabilitySource from '../../../vendor/ai-video-editor/src/lib/voiceGenerationCapability.js?raw';

// Field report (2026-09-03): one AI-generated music file showed up TWICE in the
// media panel — once as the generator named it ("AI music · 12.0s") and once as
// "VibeDev · 音频". Same on Windows, and for video as "VibeDev · 视频" beside
// "VibeDev · 8.4s", which is the same duplicate seen through the two branches of
// hostMediaMeta.
//
// Cause: three spellings of one identity that were not interchangeable.
// Merging keyed on `assetVersionId`/`versionId`; the generators recorded a
// persisted result as `hostAssetId`/`hostVersionId`, because the timeline
// placement code reads THOSE. So a clip the host had already stored matched
// nothing, and the host's copy of the same bytes arrived as a second card on
// the next asset refresh.

const HOST = { assetId: 'asset-1', versionId: 'version-1', url: '/api/projects/p/raw/music.wav' };

/** A generated clip as the AI-music hook builds it, before any host refresh. */
interface GeneratedClip extends Record<string, unknown> {
  id: string;
  meta: string;
  src: string;
  assetId?: string;
  assetVersionId?: string;
  versionId?: string;
  hostAssetId?: string;
  hostVersionId?: string;
  hostAuthorized?: boolean;
}

function generatedClip(identity: Partial<GeneratedClip> = {}): GeneratedClip {
  return {
    id: 'local-uuid',
    type: 'audio',
    name: 'ai-music.wav',
    meta: 'AI music · 12.0s',
    src: 'blob:od://app/local',
    duration: 12,
    generated: true,
    ...identity,
  };
}

describe('hostVersionIdOf', () => {
  it('reads the identity under every spelling a producer might use', () => {
    expect(hostVersionIdOf({ assetVersionId: 'v' })).toBe('v');
    expect(hostVersionIdOf({ versionId: 'v' })).toBe('v');
    // The spelling that used to be invisible to merging.
    expect(hostVersionIdOf({ hostVersionId: 'v' })).toBe('v');
  });

  it('answers "" for an asset that belongs to no host version', () => {
    expect(hostVersionIdOf({})).toBe('');
    expect(hostVersionIdOf(null)).toBe('');
    expect(hostVersionIdOf(undefined)).toBe('');
  });
});

describe('withHostIdentity', () => {
  it('stamps one identity under every spelling so consumers agree', () => {
    const stamped = withHostIdentity(generatedClip(), HOST);
    expect(stamped.assetId).toBe('asset-1');
    expect(stamped.hostAssetId).toBe('asset-1');
    expect(stamped.versionId).toBe('version-1');
    expect(stamped.assetVersionId).toBe('version-1');
    expect(stamped.hostVersionId).toBe('version-1');
    expect(stamped.hostUrl).toBe(HOST.url);
    // Placement (audioTrackActions / useVoiceGeneration) reads hostVersionId,
    // merging reads assetVersionId — both must see the same version.
    expect(hostVersionIdOf(stamped)).toBe('version-1');
  });
});

describe('mergeAuthorizedUserAssets — one file, one card', () => {
  const video = { assetId: 'canvas-file:canvas/media/video.mp4', versionId: 'canvas-file:canvas/media/video.mp4',
    url: '/api/projects/p/raw/canvas/media/video.mp4', kind: 'video', name: 'video.mp4', durationSeconds: 30.042 };
  const file = { id: 'project-file:canvas/media/video.mp4', path: 'canvas/media/video.mp4',
    url: video.url, kind: 'video' as const, name: 'video.mp4' };

  it('repairs two existing cards for the same generation while retaining measured preview metadata', () => {
    const measured = { ...authorizedAssetToUserAsset(video)!, id: 'generated-local',
      width: 1920, height: 1080, trackFrames: ['frame-at-10s'], duration: 30.042 };
    const duplicate = authorizedAssetToUserAsset(video)!;
    const result = mergeAuthorizedUserAssets([measured, duplicate], [video]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'generated-local', duration: 30.042, width: 1920,
      trackFrames: ['frame-at-10s'], sourceUrl: video.url, assetVersionId: video.versionId });
    expect(mergeAuthorizedUserAssets(result, [video])).toEqual(result);
  });

  it('admits a repeated host version only once', () => {
    expect(mergeAuthorizedUserAssets([], [video, video])).toHaveLength(1);
  });

  it.each(['file-first', 'generation-first'])('shows one ready card when two feeds describe the same file (%s)', (order) => {
    const first = order === 'file-first'
      ? mergeProjectFileUserAssets([], [file]) : mergeAuthorizedUserAssets([], [video]);
    let result = order === 'file-first'
      ? mergeAuthorizedUserAssets(first, [video]) : mergeProjectFileUserAssets(first, [file]);
    result = mergeAuthorizedUserAssets(mergeProjectFileUserAssets(result, [file]), [video]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceUrl: video.url, assetVersionId: video.versionId,
      duration: 30.042, hostAuthorized: true });
    expect(result[0]?.requiresPin).not.toBe(true);
  });

  it('keeps local uploads, another project and another version distinct despite equal names', () => {
    const otherProject = { ...file, id: 'other', url: video.url.replace('/p/', '/q/') };
    const local = { id: 'local', type: 'video', name: 'video.mp4', src: video.url };
    const otherVersion = { ...video, assetId: 'other', versionId: 'other-version' };
    const result = mergeAuthorizedUserAssets(mergeProjectFileUserAssets([local], [otherProject]), [video, otherVersion]);
    expect(result).toHaveLength(4);
    expect(result.find(asset => asset.id === 'other')).not.toHaveProperty('assetVersionId');
    expect(result.find(asset => asset.id === 'local')).toEqual(local);
  });

  it('matches a generated clip that only recorded hostVersionId, instead of duplicating it', () => {
    const current = [generatedClip({ hostAssetId: HOST.assetId, hostVersionId: HOST.versionId })];
    const merged = mergeAuthorizedUserAssets(current, [
      { ...HOST, kind: 'audio', name: 'music.wav', durationSeconds: 12 },
    ]);
    expect(merged).toHaveLength(1);
    // The generator's own card survives — its name and meta are the useful ones.
    expect(merged[0]!.id).toBe('local-uuid');
    expect(merged[0]!.meta).toBe('AI music · 12.0s');
    // …now carrying the host identity and url.
    expect(merged[0]!.assetVersionId).toBe('version-1');
    expect(merged[0]!.src).toBe(HOST.url);
  });

  it('still adds a host asset the editor has never seen', () => {
    const merged = mergeAuthorizedUserAssets([], [
      { ...HOST, kind: 'audio', name: 'music.wav', durationSeconds: 12 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('vibedev-version-1');
  });

  it('does not merge two genuinely different versions into one card', () => {
    const merged = mergeAuthorizedUserAssets(
      [generatedClip({ hostVersionId: 'version-1' })],
      [
        { ...HOST, kind: 'audio', name: 'a.wav' },
        { assetId: 'asset-2', versionId: 'version-2', url: '/raw/b.wav', kind: 'audio', name: 'b.wav' },
      ],
    );
    expect(merged).toHaveLength(2);
  });

  it('a host card carries every spelling too, so a later merge still matches it', () => {
    const card = authorizedAssetToUserAsset({ ...HOST, kind: 'audio', name: 'music.wav', durationSeconds: 12 })!;
    expect(hostVersionIdOf(card)).toBe('version-1');
    expect(card.hostVersionId).toBe('version-1');
    // Feeding it back through merging must not clone it.
    expect(mergeAuthorizedUserAssets([card], [{ ...HOST, kind: 'audio', name: 'music.wav' }])).toHaveLength(1);
  });
});

// The video duplicate had a SECOND, unrelated cause. `authorizedAssets()` in
// the host adapter is the AUTHORIZATION list: every version of an asset must be
// in it, or a timeline clip pinned to an older version throws
// project-media-version-mismatch. The editor was also treating that same list as
// the library listing, so an asset with two versions rendered two cards — both
// labelled by hostMediaMeta, which is why the pair read "VibeDev · 视频"
// (the version whose duration was never measured) beside "VibeDev · 8.4s".

describe('mergeAuthorizedUserAssets — one asset, one card', () => {
  const CURRENT = { ...HOST, kind: 'audio' as const, name: 'music.wav', durationSeconds: 12 };
  const OLDER = {
    assetId: 'asset-1', versionId: 'version-0', url: '/raw/music-v0.wav',
    kind: 'audio' as const, name: 'music.wav', supersededVersion: true,
  };

  it('adds no card for a superseded version', () => {
    const merged = mergeAuthorizedUserAssets([], [OLDER, CURRENT]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.assetVersionId).toBe('version-1');
  });

  it('still authorizes the superseded version — a pinned clip keeps its card', () => {
    // A clip pinned to the older version: its card must survive the refresh,
    // otherwise the timeline loses the media it is actually using.
    const pinned = generatedClip({ assetVersionId: 'version-0', hostAuthorized: true });
    const merged = mergeAuthorizedUserAssets([pinned], [OLDER, CURRENT]);
    expect(merged.map((asset) => asset.assetVersionId).sort()).toEqual(['version-0', 'version-1']);
  });

  it('drops a card whose version left the authorized list entirely', () => {
    const stale = generatedClip({ assetVersionId: 'version-9', hostAuthorized: true });
    expect(mergeAuthorizedUserAssets([stale], [CURRENT])).toHaveLength(1);
  });

  it('shows an entry that does not say — absent means current', () => {
    // Backward compatibility: a producer predating the flag still lists.
    const { supersededVersion: _omitted, ...unmarked } = OLDER;
    expect(mergeAuthorizedUserAssets([], [unmarked])).toHaveLength(1);
  });
});

describe('producers record the identity through the shared helper', () => {
  // Every producer that puts a card in the media panel. A card carrying only
  // part of the identity is what merging could not match.
  const CARD_PRODUCERS: ReadonlyArray<readonly [string, string]> = [
    ['App.jsx', appSource],
    ['useAiMusicGeneration', aiMusicSource],
    ['useAvatarGeneration', avatarSource],
    ['useFaceSwapGeneration', faceSwapSource],
    ['useFileUpload', fileUploadSource],
    ['useMiganRepair', miganSource],
    ['useNanoVsrRestoration', nanoVsrSource],
    ['assetDropActions', assetDropSource],
    ['voiceGenerationCapability', voiceCapabilitySource],
  ];

  /** Source with comments stripped, so prose about a field is not a match. */
  function code(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  it.each(CARD_PRODUCERS)('%s stamps identity through withHostIdentity', (_name, source) => {
    expect(source).toContain('withHostIdentity(');
    expect(source).toContain('hostAuthorizedMedia.js');
  });

  it.each(CARD_PRODUCERS)('%s hand-rolls no partial identity', (_name, source) => {
    // Reading a host result field-by-field into a card is the shape that
    // produced a half-identity. Building it from the helper is the only path.
    expect(code(source)).not.toMatch(
      /(assetId|assetVersionId|versionId|hostAssetId|hostVersionId)\s*:\s*(completion|persistedAsset|pinned|assets\[)/,
    );
  });
});

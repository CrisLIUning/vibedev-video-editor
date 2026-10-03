import { describe, expect, it, vi } from 'vitest';

import {
  documentNamesSourceAudio,
  holdsHostSourceAudio,
  hostSourceAudioAction,
  loadHostSourceAudioBlob,
  sourceAudioIdentity,
} from '../../../vendor/ai-video-editor/src/lib/sourceAudioRestore.js';
import type { SourceAudioOrigin } from '../../../vendor/ai-video-editor/src/lib/sourceAudioRestore.js';
import projectFilesSource from '../../../vendor/ai-video-editor/src/hooks/useProjectFiles.js?raw';
import audioTrackActionsSource from '../../../vendor/ai-video-editor/src/lib/audioTrackActions.js?raw';

// The source-audio lane was the one audio track a host import could only ever
// take away. Its neighbours restore from the host — the voice lane per clip
// through `restoreAuthorizedAudioSegmentSource`, the music bed through
// `loadAuthorizedProjectMediaBlob(musicSourceUrl, …)` — because each records a
// source the authorized list can be searched for. The source lane recorded a
// name, a duration, a start and an assetId, and no source at all, so the import
// fell through to `clearSourceAudioTrack("")` every time the fields looked
// changed: on a first open (no reconciler baseline, so every field counts as
// changed) and on any later refresh, because the editor's own save of the lane
// round-trips through the daemon and comes back looking like a host change.
// `getProjectSnapshot` then wrote the cleared lane back through the bridge's
// 450ms autosave — the same class as the music- and voice-track wipes fixed in
// 剪五期收尾.
//
// The fix is the identity: the lane records the AssetVersion its audio was cut
// from, in the exact shape the authorized-asset helpers already read.

const HOST_VIDEO = {
  assetId: 'video-1',
  versionId: 'video-v1',
  kind: 'video',
  name: 'take-3.mp4',
  url: '/api/projects/project-1/raw/take-3.mp4',
  mimeType: 'video/mp4',
};

const HOST_AUDIO = {
  assetId: 'audio-1',
  versionId: 'audio-v1',
  kind: 'audio',
  name: 'room-tone.wav',
  url: '/api/projects/project-1/raw/room-tone.wav',
  mimeType: 'audio/wav',
};

const VIDEO_SOURCE: SourceAudioOrigin = {
  assetId: 'video-1',
  assetVersionId: 'video-v1',
  sourceUrl: HOST_VIDEO.url,
  sourceKind: 'video',
};

function held(blob: Blob | null, source: Partial<SourceAudioOrigin> | null = null) {
  return { blob, source };
}

describe('sourceAudioIdentity', () => {
  it('reads the lane origin in the shape the authorized-asset helpers take', () => {
    expect(sourceAudioIdentity(VIDEO_SOURCE)).toEqual(VIDEO_SOURCE);
  });

  it('is null for a lane that names no origin — a local file the person dropped in', () => {
    expect(sourceAudioIdentity(null)).toBeNull();
    expect(sourceAudioIdentity({})).toBeNull();
    expect(sourceAudioIdentity({ assetId: '', assetVersionId: '', sourceUrl: '' })).toBeNull();
  });

  it('defaults the kind to audio, so only a lane that says video asks for extraction', () => {
    expect(sourceAudioIdentity({ sourceUrl: HOST_AUDIO.url })).toEqual({
      assetId: '', assetVersionId: '', sourceUrl: HOST_AUDIO.url, sourceKind: 'audio',
    });
  });
});

describe('loadHostSourceAudioBlob', () => {
  it('extracts the sound of the authorized video the lane was cut from', async () => {
    const file = new Blob(['video'], { type: 'video/mp4' });
    const sound = new Blob(['audio'], { type: 'audio/wav' });
    const fetchImpl = vi.fn(async () => new Response(file, { status: 200 }));
    const extractVideoAudio = vi.fn(async () => sound);

    await expect(loadHostSourceAudioBlob(VIDEO_SOURCE, [HOST_VIDEO], { fetchImpl, extractVideoAudio }))
      .resolves.toBe(sound);
    expect(fetchImpl).toHaveBeenCalledWith(HOST_VIDEO.url, { credentials: 'same-origin' });
    expect(extractVideoAudio).toHaveBeenCalledWith(expect.any(Blob), HOST_VIDEO.name);
  });

  it('takes an authorized audio AssetVersion as it is, with no extraction', async () => {
    const sound = new Blob(['audio'], { type: 'audio/wav' });
    const fetchImpl = vi.fn(async () => new Response(sound, { status: 200 }));
    const extractVideoAudio = vi.fn();

    await expect(loadHostSourceAudioBlob(
      { assetId: 'audio-1', assetVersionId: 'audio-v1', sourceUrl: HOST_AUDIO.url, sourceKind: 'audio' as const },
      [HOST_AUDIO],
      { fetchImpl, extractVideoAudio },
    )).resolves.toBeInstanceOf(Blob);
    expect(extractVideoAudio).not.toHaveBeenCalled();
  });

  it('reads nothing for a lane that names no origin', async () => {
    const fetchImpl = vi.fn();
    await expect(loadHostSourceAudioBlob(null, [HOST_VIDEO], { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a URL the host did not authorize, and asks for nothing', async () => {
    const fetchImpl = vi.fn();
    await expect(loadHostSourceAudioBlob(
      { sourceUrl: '/api/projects/project-2/raw/private.mp4', sourceKind: 'video' as const },
      [HOST_VIDEO],
      { fetchImpl },
    )).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers null rather than throwing when the pinned version is gone, so the cut still opens', async () => {
    const fetchImpl = vi.fn();
    await expect(loadHostSourceAudioBlob(
      { ...VIDEO_SOURCE, assetVersionId: 'video-v2' },
      [HOST_VIDEO],
      { fetchImpl },
    )).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers null when the bytes will not come', async () => {
    const failing = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadHostSourceAudioBlob(VIDEO_SOURCE, [HOST_VIDEO], {
      fetchImpl: failing, extractVideoAudio: async () => new Blob(['a']),
    })).resolves.toBeNull();
  });

  it('answers null when a video origin has no extractor to hand', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Blob(['video']), { status: 200 }));
    await expect(loadHostSourceAudioBlob(VIDEO_SOURCE, [HOST_VIDEO], { fetchImpl }))
      .resolves.toBeNull();
  });
});

describe('documentNamesSourceAudio', () => {
  it('is true for a document that claims a lane, by name, length or origin', () => {
    expect(documentNamesSourceAudio({ sourceAudioName: 'take-3 原声.wav' })).toBe(true);
    expect(documentNamesSourceAudio({ sourceAudioDuration: 12.5 })).toBe(true);
    expect(documentNamesSourceAudio({ sourceAudioSource: VIDEO_SOURCE })).toBe(true);
  });

  it('is false for a document with no source-audio lane', () => {
    expect(documentNamesSourceAudio({})).toBe(false);
    expect(documentNamesSourceAudio({ sourceAudioName: '', sourceAudioDuration: 0 })).toBe(false);
    expect(documentNamesSourceAudio(null)).toBe(false);
  });
});

describe('holdsHostSourceAudio', () => {
  const sound = new Blob(['audio'], { type: 'audio/wav' });

  it('recognises the lane the editor holds as the one the document names', () => {
    expect(holdsHostSourceAudio({ sourceAudioSource: VIDEO_SOURCE }, held(sound, VIDEO_SOURCE))).toBe(true);
  });

  it('does not recognise a different take of the same asset', () => {
    expect(holdsHostSourceAudio(
      { sourceAudioSource: { ...VIDEO_SOURCE, assetVersionId: 'video-v2' } },
      held(sound, VIDEO_SOURCE),
    )).toBe(false);
  });

  it('claims nothing when either side has no origin — two nameless lanes are not the same lane', () => {
    expect(holdsHostSourceAudio({ sourceAudioSource: VIDEO_SOURCE }, held(sound, null))).toBe(false);
    expect(holdsHostSourceAudio({}, held(sound, VIDEO_SOURCE))).toBe(false);
    expect(holdsHostSourceAudio({}, held(sound, null))).toBe(false);
  });

  it('claims nothing when the editor holds no lane at all', () => {
    expect(holdsHostSourceAudio({ sourceAudioSource: VIDEO_SOURCE }, held(null, VIDEO_SOURCE))).toBe(false);
  });
});

describe('hostSourceAudioAction', () => {
  const HOST = { hostDocument: true } as const;
  const OPENED = { hostDocument: false } as const;
  const sound = new Blob(['audio'], { type: 'audio/wav' });
  const naming = { sourceAudioName: 'take-3 原声.wav', sourceAudioDuration: 12.5, sourceAudioSource: VIDEO_SOURCE };

  it('restores whenever the bytes are in hand', () => {
    expect(hostSourceAudioAction(naming, held(null), sound, HOST)).toBe('restore');
    expect(hostSourceAudioAction(naming, held(sound, VIDEO_SOURCE), sound, HOST)).toBe('restore');
    expect(hostSourceAudioAction(naming, held(null), sound, OPENED)).toBe('restore');
  });

  it('keeps the lane the editor holds when the bytes did not come — a refresh must not take away what the host could not supply', () => {
    expect(hostSourceAudioAction(naming, held(sound, null), null, HOST)).toBe('keep');
  });

  it('records the document lane when the editor holds none, rather than saving the loss back', () => {
    // The first open of a cut whose source audio the person added: the editor is
    // empty, the bytes did not come, and clearing here is what the 450ms autosave
    // then wrote over the stored cut.
    expect(hostSourceAudioAction(naming, held(null), null, HOST)).toBe('record');
    expect(hostSourceAudioAction({ sourceAudioName: 'legacy.wav' }, held(null), null, HOST)).toBe('record');
  });

  it('clears when the document names no lane — a deletion is still a deletion', () => {
    expect(hostSourceAudioAction({ sourceAudioName: '', sourceAudioDuration: 0 }, held(null), null, HOST)).toBe('clear');
    expect(hostSourceAudioAction({}, held(sound, VIDEO_SOURCE), null, HOST)).toBe('clear');
  });

  it('clears on a project file whose archive carried no source audio — that package is the whole cut', () => {
    // Opening a .timeline file is a wholesale load, so neither the keep nor the
    // record rule applies: they exist because a HOST document is partial.
    expect(hostSourceAudioAction(naming, held(null), null, OPENED)).toBe('clear');
    expect(hostSourceAudioAction(naming, held(sound, VIDEO_SOURCE), null, OPENED)).toBe('clear');
    expect(hostSourceAudioAction(naming, held(sound, null), null, undefined)).toBe('clear');
  });
});

describe('the editor records and restores the lane origin', () => {
  it('saves the origin into the snapshot, beside the name the lane already recorded', () => {
    expect(projectFilesSource).toMatch(/sourceAudioSource: deps\.sourceAudioSource/);
  });

  it('routes the import through the outcome rather than falling through to a clear', () => {
    expect(projectFilesSource).toContain('hostSourceAudioAction(');
    expect(projectFilesSource).toContain('loadHostSourceAudioBlob(');
    // The shape that cleared the lane whenever the host had no archive media.
    expect(projectFilesSource).not.toMatch(/else deps\.clearSourceAudioTrack\(""\);/);
  });

  it('gates the lane on its origin too, so a changed origin is a changed lane', () => {
    expect(projectFilesSource).toMatch(/hostChanged\([^)]*"sourceAudioSource"/s);
  });

  it('records the origin only for audio the track actions were handed one for', () => {
    // A vocal stem or an appended collection is not the AssetVersion's own sound;
    // restoring that AssetVersion in its place would silently change the cut.
    expect(audioTrackActionsSource).toContain('setSourceAudioSource');
  });
});

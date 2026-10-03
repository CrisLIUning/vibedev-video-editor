import { describe, expect, it, vi } from 'vitest';

import { createAudioTrackActions } from '../../../vendor/ai-video-editor/src/lib/audioTrackActions.js';

describe('persisted TTS timeline identity', () => {
  it('stores the exact host AssetVersion source on the generated audio segment', () => {
    let audioSegments: any[] = [];
    const setAudioSegments = vi.fn((update) => { audioSegments = update(audioSegments); });
    const actions = createAudioTrackActions({
      script: '旁白', selectedVoice: { name: 'Voice' }, currentTimeRef: { current: 0 },
      audioSegments, audioSegmentRefs: { current: new Map() }, setAudioSegments,
      setSelectedAudioSegmentId: vi.fn(), setSelectedTrack: vi.fn(), setCurrentTime: vi.fn(),
      setStatus: vi.fn(), setStatusText: vi.fn(), setProgress: vi.fn(), t: (key: string) => key,
    });

    const segment = actions.replaceAudio(
      new Blob(['wave'], { type: 'audio/wav' }), 1, [], 'done',
      {
        assetId: 'asset-voice',
        assetVersionId: 'version-voice',
        sourceUrl: '/api/projects/project-1/raw/voice.wav',
      },
    );

    expect(segment).toMatchObject({
      assetId: 'asset-voice',
      assetVersionId: 'version-voice',
      sourceUrl: '/api/projects/project-1/raw/voice.wav',
    });
    expect(audioSegments[0]).toEqual(segment);
  });
});

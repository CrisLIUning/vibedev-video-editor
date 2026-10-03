import { expect, it, vi } from 'vitest';
// @ts-expect-error Pinned vendor JS has no declaration for its internal mixer.
import { mixOfflineAudio } from '../../../vendor/ai-video-editor/src/lib/offlineVideoExport.js';

it('does not decode or export explicitly muted music or voiceover', async () => {
  // These invalid bytes must never reach a decoder: all selected inputs are muted.
  const blob = new Blob(['must not decode']);
  expect(
    await mixOfflineAudio({
      duration: 2,
      musicBlob: blob,
      musicSegments: [{ id: 'm', start: 0, duration: 2, muted: true }],
      voiceAudioSegments: [{ id: 'v', start: 0, duration: 2, blob, muted: true }],
    }),
  ).toBeNull();
});


it('stops at the timeline clip edge even when an older document retains a longer source range', async () => {
  const start = vi.fn();
  const decoded = { duration: 10, sampleRate: 48000, length: 480000, numberOfChannels: 2 };
  class Decoder { async decodeAudioData() { return decoded; } async close() {} }
  const connect = (destination: unknown) => destination;
  class Offline {
    destination = {};
    createBufferSource() { return { playbackRate: { value: 1 }, connect, start }; }
    createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect }; }
    createDelay() { return { delayTime: {}, connect }; }
    createConvolver() { return { connect }; }
    createBiquadFilter() { return { frequency: {}, connect }; }
    async startRendering() { return {}; }
  }
  vi.stubGlobal('window', { AudioContext: Decoder, OfflineAudioContext: Offline });
  try {
    await mixOfflineAudio({ duration: 12, voiceAudioSegments: [{ id: 'short', start: 0, duration: 2, sourceDuration: 10, sourceStart: 0, playbackRate: 1, blob: new Blob(['fixture']) }] });
    expect(start).toHaveBeenCalledWith(0, 0, 2);
  } finally { vi.unstubAllGlobals(); }
});

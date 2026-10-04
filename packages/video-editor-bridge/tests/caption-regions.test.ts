import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  base64Of,
  encodePcm16Wav,
  isDigitalSilence,
  mergeSpeechRegions,
  planSpeechRegions,
  splitLongRegions,
} from '../src/caption-regions';

const detectSpeech = vi.fn();
vi.mock('../../../vendor/ai-video-editor/src/lib/speechVad.js', () => ({ detectSpeech }));
// The Whisper half is not exercised here; its browser-only modules stay out of Node.
vi.mock('../../../vendor/ai-video-editor/src/lib/asr.js', () => ({ transcribeAudioToCaptionSegments: vi.fn() }));
vi.mock('../../../vendor/ai-video-editor/src/lib/media.js', () => ({ sliceAudioBlob: vi.fn() }));

describe('speech regions for a text-only recognizer', () => {
  it('merges regions across short gaps, but never past fifteen seconds', () => {
    expect(mergeSpeechRegions([{ start: 2, end: 3 }, { start: 0, end: 1.8 }, { start: 3.5, end: 4 }])).toEqual([
      { start: 0, end: 3 },
      { start: 3.5, end: 4 },
    ]);
    expect(mergeSpeechRegions([{ start: 0, end: 10 }, { start: 10.1, end: 16 }])).toEqual([
      { start: 0, end: 10 },
      { start: 10.1, end: 16 },
    ]);
  });

  it('splits a region over thirty seconds at its quietest frame, so both pieces fit', () => {
    const frame = 0.032;
    const probabilities = Array.from({ length: Math.ceil(50 / frame) }, (_, index) => (Math.abs(index * frame - 21) < 0.01 ? 0.05 : 0.9));
    const pieces = splitLongRegions([{ start: 0, end: 50 }], probabilities, frame);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.start).toBe(0);
    expect(pieces[0]!.end).toBeCloseTo(21, 1);
    expect(pieces[1]!.end).toBe(50);
    for (const piece of pieces) expect(piece.end - piece.start).toBeLessThanOrEqual(30);
  });

  it('keeps splitting a long monologue until every piece fits, and leaves short regions alone', () => {
    const pieces = splitLongRegions([{ start: 5, end: 100 }, { start: 101, end: 104 }], new Array(4000).fill(0.9), 0.032);
    for (const piece of pieces) expect(piece.end - piece.start).toBeLessThanOrEqual(30);
    expect(pieces[0]!.start).toBe(5);
    expect(pieces.at(-2)!.end).toBe(100);
    expect(pieces.at(-1)).toEqual({ start: 101, end: 104 });
    // Contiguous: nothing heard is dropped between pieces.
    for (let index = 1; index < pieces.length - 1; index += 1) expect(pieces[index]!.start).toBe(pieces[index - 1]!.end);
    expect(planSpeechRegions([{ start: 0, end: 1 }, { start: 1.1, end: 2 }], [], 0.032)).toEqual([{ start: 0, end: 2 }]);
  });

  it('writes a 16-bit mono WAV and its base64', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
    expect(base64Of(new Uint8Array([104, 105]))).toBe('aGk=');
    expect(isDigitalSilence(new Float32Array(4))).toBe(true);
    expect(isDigitalSilence(new Float32Array([0, 1e-9]))).toBe(false);
  });
});

describe('extractTimelineAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    detectSpeech.mockReset();
  });

  /** A decoder that hands back four seconds of two-channel 16 kHz audio. */
  function stubDecoder(left: number, right: number) {
    const rates: number[] = [];
    class FakeAudioContext {
      constructor(options: { sampleRate: number }) { rates.push(options.sampleRate); }
      async decodeAudioData() {
        const length = 4 * 16000;
        return { sampleRate: 16000, length, numberOfChannels: 2, getChannelData: (channel: number) => new Float32Array(length).fill(channel === 0 ? left : right) };
      }
      async close() {}
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']))));
    return rates;
  }

  it('decodes the stretch at 16 kHz mono and returns merged regions in source seconds with their audio', async () => {
    const rates = stubDecoder(0.5, 0.1);
    detectSpeech.mockImplementation(async (audio: Float32Array, model: string) => {
      expect(model).toBe('/models/silero');
      expect(audio).toHaveLength(32000);
      expect(audio[0]).toBeCloseTo(0.3, 5);
      return { probabilities: [], frameSeconds: 0.032, regions: [{ start: 0.2, end: 0.6 }, { start: 0.8, end: 1.2 }] };
    });
    const { extractTimelineAudio } = await import('../src/transcription-runtime');
    const progress: number[] = [];
    const result = await extractTimelineAudio(
      { sources: [{ clipId: 'v1', url: '/source/0', sourceIn: 1, sourceOut: 3 }], artifacts: { 'speech-vad': '/models/silero' }, language: 'zh' },
      update => progress.push(update.progress),
      new AbortController().signal,
    );
    expect(rates).toEqual([16000]);
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceClipId).toBe('v1');
    expect(result[0]!.regions.map(region => [region.start, region.end])).toEqual([[1.2, 2.2]]);
    const wav = Uint8Array.from(atob(result[0]!.regions[0]!.wav), character => character.charCodeAt(0));
    expect(wav.length).toBe(44 + 16000 * 2);
    expect(progress.at(-1)).toBe(100);
  });

  it('skips the detector on digital silence, and stops when cancelled', async () => {
    stubDecoder(0, 0);
    const { extractTimelineAudio } = await import('../src/transcription-runtime');
    const input = { sources: [{ clipId: 'a', url: '/s', sourceIn: 0, sourceOut: 2 }], artifacts: {}, language: 'zh' };
    expect(await extractTimelineAudio(input, () => {}, new AbortController().signal)).toEqual([{ sourceClipId: 'a', regions: [] }]);
    expect(detectSpeech).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort(new DOMException('Canceled', 'AbortError'));
    await expect(extractTimelineAudio(input, () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

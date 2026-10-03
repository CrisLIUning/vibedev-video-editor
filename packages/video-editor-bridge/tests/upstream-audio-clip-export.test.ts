import { afterEach, expect, it, vi } from 'vitest';
const { mix } = vi.hoisted(() => ({ mix: vi.fn() }));
vi.mock('../../../vendor/ai-video-editor/src/lib/offlineVideoExport.js', () => ({ mixOfflineAudio: mix }));
import { renderAudioClipFile } from '../../../vendor/ai-video-editor/src/lib/audioClipExport.js';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
const buffer = () => ({ numberOfChannels: 2, length: 120_000, sampleRate: 48_000, duration: 2.5,
  getChannelData: () => new Float32Array(120_000).fill(0.5) });

it('exports only the selected trimmed interval, preserving its sound edits in a real WAV', async () => {
  mix.mockResolvedValue(buffer());
  const segment = { id: 'part', blob: new Blob(['sound']), name: '对白.mp4', start: 20, duration: 2.5,
    sourceStart: 7, sourceDuration: 5, playbackRate: 2, volume: 0.6, fadeIn: 0.2 };
  const file = await renderAudioClipFile(segment);
  expect(mix).toHaveBeenCalledWith({ duration: 2.5, voiceAudioSegments: [{ ...segment, start: 0 }] });
  expect(segment.start).toBe(20);
  expect(file).toMatchObject({ kind: 'audio', name: '对白.wav', durationSeconds: 2.5 });
  expect(file.blob.type).toBe('audio/wav');
  const bytes = await file.blob.arrayBuffer(), view = new DataView(bytes);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(view.getUint32(24, true)).toBe(48_000);
  expect(view.getUint32(40, true)).toBe(120_000 * 2 * 2);
  expect(view.getInt16(44, true)).toBeGreaterThan(0);
});

it('rehydrates an authorized saved clip before rendering, so reopening the cut still works', async () => {
  mix.mockResolvedValue(buffer());
  const fetcher = vi.fn(async () => new Response(new Blob(['persisted wav'])));
  vi.stubGlobal('fetch', fetcher);
  const url = '/api/projects/film/raw/canvas/renders/line.wav';
  const file = await renderAudioClipFile({ id: 'saved', assetId: 'line', assetVersionId: 'v1', sourceUrl: url, duration: 2.5 },
    [{ assetId: 'line', versionId: 'v1', kind: 'audio', name: 'line.wav', url, mimeType: 'audio/wav' }]);
  expect(fetcher).toHaveBeenCalledWith(url, { credentials: 'same-origin' });
  expect(file.kind).toBe('audio');
  expect(mix.mock.calls[0]![0].voiceAudioSegments[0].blob.size).toBeGreaterThan(0);
});

it('does not upload missing or invalid audio as a successful export', async () => {
  await expect(renderAudioClipFile({ duration: 2 })).rejects.toThrow('音频原文件不可用');
  await expect(renderAudioClipFile({ blob: new Blob(['sound']), duration: 0 })).rejects.toThrow('音频片段时长无效');
  expect(mix).not.toHaveBeenCalled();
});

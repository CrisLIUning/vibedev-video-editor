import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extractAudioFromVideo = vi.fn();
const decodeWaveform = vi.fn();
const concatenateAudioBlobs = vi.fn();

// The vendored media library is the whole ffmpeg.wasm runtime and a Vite
// asset graph with it. What this file is about is the decision taken around
// the extraction, so the extraction itself is a stub.
vi.mock('../../../vendor/ai-video-editor/src/lib/media.js', () => ({
  extractAudioFromVideo: (...args: unknown[]) => extractAudioFromVideo(...args),
  decodeWaveform: (...args: unknown[]) => decodeWaveform(...args),
  concatenateAudioBlobs: (...args: unknown[]) => concatenateAudioBlobs(...args),
}));

import { prepareEmbeddedVideoAudio } from '../../../vendor/ai-video-editor/src/lib/embeddedVideoAudioExport.js';
import {
  describeSourceAudioFailure,
  isSilentSourceError,
  reportsNoAudioStream,
} from '../../../vendor/ai-video-editor/src/lib/sourceAudioAvailability.js';
import videoExportRaw from '../../../vendor/ai-video-editor/src/hooks/useVideoExport.js?raw';

// A Windows checkout has CRLF line endings; the pinned lines are written with \n.
const videoExportSource = videoExportRaw.replace(/\r\n/g, '\n');

/**
 * A video clip's own sound, in the browser export.
 *
 * Observed 2026-09-07 exporting the film-demo cut: "Embedded video audio
 * extraction skipped 第 2 镜 · cam_1 ErrnoError: FS error", and a finished
 * file the person was told nothing about. The error is what ffmpeg.wasm says
 * when the output was never created, which is what happens both when the file
 * has no audio stream to extract and when the extraction genuinely failed.
 * The export could not tell those apart, so it treated both as nothing to
 * mention — and a shot's sound could go missing without a word.
 *
 * The two cases are settled here. A take with no sound in it costs the render
 * nothing and is passed over in silence, the same answer the headless lane
 * gives by leaving it out of `media.sourceAudio`. A sound the export was
 * supposed to mix and could not get stops the export, exactly as a voice clip
 * without media already does.
 */

// ffmpeg's own words, from the film-demo take (one video stream, no audio)
// and from a control clip that has both.
const SILENT_TAKE_LOG = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'mtp9u1rm-JnpAxd-canvas-video.mp4':",
  '  Stream #0:0[0x1](und): Video: h264 (Baseline) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1280x720, 1714 kb/s, SAR 1:1 DAR 16:9, 30.09 fps, 30 tbr, 30k tbn (default)',
  '[out#0/wav @ 0x7d5038180] Output file does not contain any stream',
  'Error opening output file source-audio-1.wav.',
];

const RECORDED_TAKE_LOG = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'take-1.mp4':",
  '  Stream #0:0[0x1](und): Video: h264 (High 4:4:4 Predictive) (avc1 / 0x31637661), yuv444p(progressive), 320x240 [SAR 1:1 DAR 4:3], 47 kb/s, 25 fps, 25 tbr, 12800 tbn (default)',
  '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)',
];

const fsError = () => {
  const error = new Error('FS error');
  error.name = 'ErrnoError';
  return error;
};

describe('what ffmpeg saw in the file', () => {
  it('reads a take with no audio stream as having no sound to lose', () => {
    expect(reportsNoAudioStream(SILENT_TAKE_LOG)).toBe(true);

    const cause = fsError();
    const described = describeSourceAudioFailure(cause, SILENT_TAKE_LOG);
    expect(isSilentSourceError(described)).toBe(true);
    // The original failure is kept: this is a classification, not a rewrite.
    expect((described as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it('reads a take that does have sound as a failure, unchanged', () => {
    expect(reportsNoAudioStream(RECORDED_TAKE_LOG)).toBe(false);

    const cause = fsError();
    expect(describeSourceAudioFailure(cause, RECORDED_TAKE_LOG)).toBe(cause);
    expect(isSilentSourceError(cause)).toBe(false);
  });

  it('fails loud when it cannot tell, rather than calling the file silent', () => {
    // A run that never reported a stream is a file we could not read. Calling
    // that silence is how a lost sound gets through, so the unreadable case
    // stays a failure.
    expect(reportsNoAudioStream([])).toBe(false);
    expect(reportsNoAudioStream(['ffmpeg version 6.0', 'take-1.mp4: Invalid data found when processing input'])).toBe(false);

    const cause = fsError();
    expect(describeSourceAudioFailure(cause, [])).toBe(cause);
  });
});

// The film-demo cut: two shots trimmed out of one 4-second take, which is why
// one extraction decides the sound of both.
const shots = () => ([
  {
    id: 'shot_cam1_a',
    name: '第 1 镜 · cam_1',
    type: 'video',
    src: '/api/projects/film-demo/raw/canvas/uploads/mtp9u1rm-JnpAxd-canvas-video.mp4',
    assetId: 'canvas-file:canvas/uploads/mtp9u1rm-JnpAxd-canvas-video.mp4',
    duration: 2,
    sourceStart: 0,
    sourceDuration: 2,
  },
  {
    id: 'shot_cam1_b',
    name: '第 2 镜 · cam_1',
    type: 'video',
    src: '/api/projects/film-demo/raw/canvas/uploads/mtp9u1rm-JnpAxd-canvas-video.mp4',
    assetId: 'canvas-file:canvas/uploads/mtp9u1rm-JnpAxd-canvas-video.mp4',
    duration: 2,
    sourceStart: 2,
    sourceDuration: 2,
  },
]);

const servingTheTake = () => vi.fn(async () => new Response(new Blob(['video']), { status: 200 }));

describe('the sound the browser export could not get', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('passes over a take that never had a sound, and says nothing', async () => {
    vi.stubGlobal('fetch', servingTheTake());
    extractAudioFromVideo.mockRejectedValue(describeSourceAudioFailure(fsError(), SILENT_TAKE_LOG));

    const prepared = await prepareEmbeddedVideoAudio(shots());

    // Exactly the render the cut describes. Reporting this would put a notice
    // on every silent shot the film module generates.
    expect(prepared).toEqual({ blob: null, segments: [], lost: [] });
  });

  it('names every shot cut from a take whose sound it lost, not just the last', async () => {
    vi.stubGlobal('fetch', servingTheTake());
    extractAudioFromVideo.mockRejectedValue(fsError());

    const { blob, lost } = await prepareEmbeddedVideoAudio(shots());

    expect(blob).toBeNull();
    // One take, one key, one extraction — and two shots that go silent. The
    // warning in the console only ever named 第 2 镜.
    expect(lost).toEqual([
      { id: 'shot_cam1_a', name: '第 1 镜 · cam_1', start: 0, duration: 2 },
      { id: 'shot_cam1_b', name: '第 2 镜 · cam_1', start: 2, duration: 2 },
    ]);
  });

  it('counts a file it could not read as a sound it lost', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));

    const refused = await prepareEmbeddedVideoAudio(shots());
    expect(refused.lost.map((clip) => clip.id)).toEqual(['shot_cam1_a', 'shot_cam1_b']);
    expect(extractAudioFromVideo).not.toHaveBeenCalled();

    // Nor is a clip with nothing to read from any quieter about it.
    const unplaceable = await prepareEmbeddedVideoAudio([{ ...shots()[0]!, src: '' }]);
    expect(unplaceable.lost.map((clip) => clip.id)).toEqual(['shot_cam1_a']);
  });

  it('reports nothing lost when the sound is there, and still mixes it', async () => {
    vi.stubGlobal('fetch', servingTheTake());
    const audio = new Blob(['wav'], { type: 'audio/wav' });
    const mixed = new Blob(['mixed'], { type: 'audio/wav' });
    extractAudioFromVideo.mockResolvedValue(audio);
    decodeWaveform.mockResolvedValue({ duration: 4, peaks: [] });
    concatenateAudioBlobs.mockResolvedValue(mixed);

    const prepared = await prepareEmbeddedVideoAudio(shots());

    expect(prepared.lost).toEqual([]);
    expect(prepared.blob).toBe(mixed);
    expect(prepared.segments.map((segment) => (
      { id: segment.id, start: segment.start, sourceStart: segment.sourceStart }
    ))).toEqual([
      { id: 'shot_cam1_a', start: 0, sourceStart: 0 },
      { id: 'shot_cam1_b', start: 2, sourceStart: 2 },
    ]);
  });

  it('leaves a shot the person muted alone', async () => {
    const fetchImpl = servingTheTake();
    vi.stubGlobal('fetch', fetchImpl);
    extractAudioFromVideo.mockRejectedValue(fsError());

    const muted = shots().map((shot) => ({ ...shot, sourceAudioDisabled: true }));
    expect(await prepareEmbeddedVideoAudio(muted)).toEqual({ blob: null, segments: [], lost: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a cancelled export as cancelled, not as a lost sound', async () => {
    vi.stubGlobal('fetch', servingTheTake());
    const canceled = new Error('Export canceled');
    canceled.name = 'AbortError';
    extractAudioFromVideo.mockRejectedValue(canceled);

    await expect(prepareEmbeddedVideoAudio(shots())).rejects.toBe(canceled);
  });
});

describe('what the export does about it', () => {
  it('refuses the export the way it refuses a voice clip without media', () => {
    // Pinned in the vendored source: a fork line an upstream sync must replay.
    expect(videoExportSource).toContain('const lostSourceAudio = (embeddedVideoAudio.lost || []).filter');
    expect(videoExportSource).toContain('的原声没能取回，成片会缺这段声音');
    // Told, then stopped — the status text lives in a panel that need not be
    // open, so the refusal also goes through the editor's own toast.
    expect(videoExportSource).toContain('        notify(message);\n        throw new Error(message);');
  });

  it('judges only the shots inside the range being exported', () => {
    // A partial export is not spoiled by a shot it does not contain, which is
    // the same test the voice lane applies to its own clips.
    expect(videoExportSource).toContain('clip.start < exportRange.end && clip.start + clip.duration > exportRange.start');
  });

  it('still asks for nothing when the source lane is hidden', () => {
    // Upstream's own gate, unchanged: hiding the lane is how a person says
    // the render is meant to be without these sounds.
    expect(videoExportSource).toContain("exportAudio && d.trackVisibility.source !== false");
  });
});

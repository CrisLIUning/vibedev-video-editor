import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MIN_FRAME_QUALITY,
  describeWindowWithRetry,
  generateFrameCaptions,
  isAbortError,
  segmentAnchorFrame,
  selectChangedFrames,
} from '../../../vendor/ai-video-editor/src/lib/autoEdit.js';
import autoEditSource from '../../../vendor/ai-video-editor/src/lib/autoEdit.js?raw';

// Field report (2026-09-03): auto-edit sometimes wrote a caption describing a
// completely black screen, and a `vision gateway timed out` cost a whole clip
// its captions.
//
// The black caption was an accurate description of what the model was sent.
// Frame extraction seeks a detached <video> and drew on the `seeked` event —
// which says the playback position moved, not that a frame is ready to draw.
// `drawContainedFrame` fills black before drawing, so a draw that contributed
// nothing produced a perfectly black JPEG.
//
// The irony is that the local detector already knew: `frameQuality` scores such
// a frame 0, and there is a >= 0.28 gate for exactly this. But the frame that
// stands for a segment was selected unconditionally, bypassing the gate — and
// the first frame of a segment is precisely the one most likely to have been
// captured before the video had a picture to give.

function frame(overrides: Record<string, unknown> = {}) {
  return {
    segmentId: 'visual-1',
    segmentIndex: 0,
    segmentName: 'Clip',
    segmentStart: 0,
    segmentEnd: 8,
    time: 0,
    difference: 1,
    quality: 1,
    ...overrides,
  };
}

describe('segmentAnchorFrame', () => {
  it('skips a frame the extractor captured with no picture in it', () => {
    const dead = frame({ time: 0, quality: 0 });
    const alive = frame({ time: 1.4, quality: 0.9 });
    expect(segmentAnchorFrame([dead, alive])).toBe(alive);
  });

  it('keeps the first frame when the segment really is dark throughout', () => {
    // A clip that opens on black and stays there has no better answer, and
    // saying nothing about it would be worse than describing it.
    const first = frame({ time: 0, quality: 0 });
    expect(segmentAnchorFrame([first, frame({ time: 1.4, quality: 0 })])).toBe(first);
  });

  it('takes the first frame when it already carries an image', () => {
    const first = frame({ time: 0, quality: 0.8 });
    expect(segmentAnchorFrame([first, frame({ time: 1.4, quality: 1 })])).toBe(first);
  });

  it('treats an unscored frame as usable rather than dropping it', () => {
    const unscored = frame({ time: 0, quality: undefined });
    expect(segmentAnchorFrame([unscored])).toBe(unscored);
  });
});

describe('selectChangedFrames anchors every segment on a frame with a picture', () => {
  it('does not hand a black opening frame to the caption model', () => {
    const selected = selectChangedFrames([
      frame({ time: 0, quality: 0, difference: 1 }),
      frame({ time: 1.5, quality: 0.9, difference: 0.9 }),
      frame({ time: 3, quality: 0.9, difference: 0.2 }),
    ]);
    expect(selected.some((item) => item.quality === 0)).toBe(false);
    expect(selected.length).toBeGreaterThan(0);
  });

  it('still gives every segment a representative frame', () => {
    const selected = selectChangedFrames([
      frame({ segmentId: 'a', time: 0, quality: 0 }),
      frame({ segmentId: 'a', time: 1.5, quality: 0.9 }),
      frame({ segmentId: 'b', time: 3, quality: 0 }),
      frame({ segmentId: 'b', time: 4.5, quality: 0.7 }),
    ]);
    expect(new Set(selected.map((item) => item.segmentId))).toEqual(new Set(['a', 'b']));
  });

  it('gates on one named threshold rather than a repeated literal', () => {
    expect(MIN_FRAME_QUALITY).toBe(0.28);
    expect(autoEditSource).not.toMatch(/quality \?\? 1\) >= \.28/);
  });
});

describe('extraction waits for a frame that was actually presented', () => {
  it('seeks through the shared helper instead of drawing on `seeked`', () => {
    expect(autoEditSource).toContain('await seekVideoFrame(video,');
    // The naive pair that captured nothing.
    expect(autoEditSource).not.toContain('await waitForMedia(video, "seeked")');
  });
});

describe('a batch the model does not answer', () => {
  // Backoff on a virtual clock: the wait is the behaviour under test, so it is
  // asserted on both sides of the boundary rather than slept through.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits out the backoff before retrying, and retries exactly once', async () => {
    vi.useFakeTimers();
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('vision gateway timed out'))
      .mockResolvedValueOnce('ok');
    const pending = describeWindowWithRetry(run, undefined, 1_200);

    await vi.advanceTimersByTimeAsync(1_199);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toBe('ok');
  });

  it('gives up after the retry rather than hammering a busy gateway', async () => {
    const run = vi.fn().mockRejectedValue(new Error('vision gateway timed out'));
    await expect(describeWindowWithRetry(run, undefined, 0)).rejects.toThrow('timed out');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never retries a cancellation — that is the person stopping the run', async () => {
    const run = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(describeWindowWithRetry(run, undefined, 0)).rejects.toThrow('Aborted');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('recognises an abort by name and by legacy code', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(Object.assign(new Error('x'), { code: 20 }))).toBe(true);
    expect(isAbortError(new Error('vision gateway timed out'))).toBe(false);
  });
});

describe('one failed batch does not cost the clip its other batches', () => {
  // These drive real backoffs between batches; the clock is virtual so the file
  // costs milliseconds instead of seconds.
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Settle a caption run whose batches back off, without real waiting. */
  async function settle<T>(pending: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(30_000);
    return pending;
  }

  /** Enough frames for three sliding windows (size 6, stride 4). */
  function windowFrames() {
    return Array.from({ length: 14 }, (_, index) => ({
      segmentId: 'visual-1',
      segmentIndex: 0,
      segmentName: 'Clip',
      segmentStart: 0,
      segmentEnd: 28,
      time: index * 2,
      blob: new Blob([`f${index}`]),
    }));
  }

  it('keeps the captions from the batches that did answer', async () => {
    let call = 0;
    const describeFrames = vi.fn(async (frames: Array<{ time: number }>) => {
      call += 1;
      // Every attempt at the first batch fails; the rest answer.
      if (call <= 2) throw new Error('vision gateway timed out');
      return frames.map((_frame, index) => `画面 ${index + 1}`);
    });

    vi.useFakeTimers();
    const captions = await settle(generateFrameCaptions({
      frames: windowFrames(),
      duration: 28,
      language: 'zh',
      describeFrames,
    }));

    expect(captions.length).toBeGreaterThan(0);
    // First batch: two attempts. The remaining batches then ran.
    expect(describeFrames.mock.calls.length).toBeGreaterThan(2);
  });

  it('reports the clip as failed only when no batch produced anything', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const captions = await settle(generateFrameCaptions({
      frames: windowFrames(),
      duration: 28,
      language: 'zh',
      describeFrames: vi.fn(async () => { throw new Error('vision gateway timed out'); }),
      onPartial: (partial: { status: string }) => { statuses.push(partial.status); },
    }));
    expect(captions).toHaveLength(0);
    expect(statuses.at(-1)).toBe('error');
  });

  it('stops the whole run when the person cancels, instead of retrying batches', async () => {
    const describeFrames = vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); });
    const statuses: string[] = [];
    await generateFrameCaptions({
      frames: windowFrames(),
      duration: 28,
      language: 'zh',
      describeFrames,
      onPartial: (partial: { status: string }) => { statuses.push(partial.status); },
    });
    expect(describeFrames).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('error');
  });
});

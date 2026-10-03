import { describe, it, expect } from 'vitest';
// @ts-expect-error pinned vendor pure helpers
import { captionEvidence } from '../../../vendor/ai-video-editor/src/lib/captionEvidence.js';
// @ts-expect-error pinned vendor pure helpers
import { speechRegions } from '../../../vendor/ai-video-editor/src/lib/speechRegions.js';
import { getTimelineSourceTime, getTimelineLocalTime } from '../src/timeline-source-time';
describe('caption evidence and exact editor time mapping', () => {
  it('preserves complete sentences and pauses; never applies volume-peak realignment', () => {
    const raw = {
      chunks: [
        { text: '她会不会仔细看', timestamp: [11.2, 12.48] },
        { text: '我让她签的东西', timestamp: [13.24, 14.64] },
      ],
    };
    expect(captionEvidence(raw, 30).segments.map((s: any) => [s.start, s.end])).toEqual([
      [11.2, 12.48],
      [13.24, 14.64],
    ]);
  });
  it('keeps missing, null, reversed, overlapping, and out-of-file timestamps as rejected evidence', () => {
    const r = captionEvidence(
      {
        chunks: [
          { text: 'one', timestamp: [null, 2] },
          { text: 'two', timestamp: [4, 3] },
          { text: 'valid', timestamp: [1, 3] },
          { text: 'overlap', timestamp: [2, 4] },
          { text: 'past', timestamp: [3, 31] },
        ],
      },
      30,
    );
    expect(r.rejected).toHaveLength(4);
    expect(r.segments).toHaveLength(1);
    expect(captionEvidence({ text: 'not aligned' }, 30).segments).toEqual([]);
    expect(captionEvidence({ chunks: [{ text: '跨分块', timestamp: [29.8, 31.2] }] }, 40).segments[0].end).toBe(31.2);
  });
  it('uses speech probability with hysteresis; retains quiet tails and pauses, silence yields no region', () => {
    expect(speechRegions(Array(100).fill(0), 3.2)).toEqual([]);
    const probabilities = [
      ...Array(10).fill(0),
      ...Array(8).fill(0.8),
      ...Array(8).fill(0.1),
      ...Array(8).fill(0.4),
      ...Array(30).fill(0),
    ];
    const r = speechRegions(probabilities, 2.048);
    expect(r).toHaveLength(1);
    expect(r[0].end).toBeCloseTo(1.488);
    expect(r[0].start).toBeCloseTo(0.07);
  });
  for (const rate of [0.25, 0.5, 1, 1.0082781581356495, 2, 4])
    it(`round trips clipped constant rate ${rate}`, () => {
      const clip = { sourceStart: 7, sourceDuration: 10 * rate, duration: 10, playbackRate: rate };
      expect(getTimelineLocalTime(clip, getTimelineSourceTime(clip, 3.234567))).toBeCloseTo(3.234567, 9);
    });
  it('inverts the actual smooth speed-curve integration instead of interpolating sampled knots', () => {
    const clip = {
      sourceStart: 4,
      sourceDuration: 83,
      duration: 35,
      speedCurve: {
        enabled: true,
        smooth: true,
        points: [
          { progress: 0, rate: 0.25 },
          { progress: 0.127, rate: 4 },
          { progress: 0.679, rate: 0.5 },
          { progress: 1, rate: 2 },
        ],
      },
    };
    for (const t of [0.02, 1.239483, 4.73425, 17.9284, 33.9])
      expect(getTimelineLocalTime(clip, getTimelineSourceTime(clip, t))).toBeCloseTo(t, 9);
  });
});

it('retains a bounded terminal overrun as estimated evidence, never inventing a missing timestamp', () => {
  const output = {
    chunks: [{ text: 'real terminal sentence', timestamp: [30.758, 34.758], region: { start: 30.758, end: 34.379 } }],
  };
  const result = captionEvidence(output, 34.379);
  expect(result.segments[0]).toMatchObject({
    start: 30.758,
    end: 34.379,
    rawEnd: 34.758,
    warnings: ['estimated-end-clipped-to-audio'],
    reviewStatus: 'unreviewed',
  });
  expect(result.adjustments[0]).toMatchObject({ rawEnd: 34.758, end: 34.379, estimated: true });
  expect(captionEvidence({ chunks: [{ text: 'invalid', timestamp: [30.758, 36] }] }, 34.379).segments).toEqual([]);
  expect(captionEvidence({ chunks: [{ text: 'missing', timestamp: [30.758, null] }] }, 34.379).segments).toEqual([]);
});

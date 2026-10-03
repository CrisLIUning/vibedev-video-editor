import { describe, expect, it } from 'vitest';

import {
  getVisualPlaybackRateAtTime,
  getVisualSourceTime,
  requiresTimelineDrivenVideoFrames,
  shouldUseNativeVisualPlayback,
} from '../../../vendor/ai-video-editor/src/lib/visualEffects.js';

const segment = {
  duration: 4,
  playbackRate: 1,
  sourceStart: 0,
  sourceDuration: 3,
  vibedevTimeRemapRuntime: {
    duration: 4,
    segments: [{
      kind: 'play',
      sourceInSeconds: 0,
      sourceOutSeconds: 2,
      durationSeconds: 2,
      rate: 1,
      reverse: false,
    }, {
      kind: 'freeze',
      sourceSeconds: 2,
      durationSeconds: 1,
    }, {
      kind: 'play',
      sourceInSeconds: 2,
      sourceOutSeconds: 1,
      durationSeconds: 1,
      rate: 1,
      reverse: true,
    }],
  },
};

describe('VibeDev time-remap runtime in the fork', () => {
  it('maps timeline time through forward, freeze, and reverse source steps', () => {
    expect(getVisualSourceTime(segment, 0.5)).toBeCloseTo(0.5);
    expect(getVisualSourceTime(segment, 2.5)).toBeCloseTo(2);
    expect(getVisualSourceTime(segment, 3.5)).toBeCloseTo(1.5);
  });

  it('uses timeline-driven frames when native video playback cannot express the remap', () => {
    expect(requiresTimelineDrivenVideoFrames(segment)).toBe(true);
    expect(getVisualPlaybackRateAtTime(segment, 0.5)).toBeCloseTo(1);
    expect(getVisualPlaybackRateAtTime(segment, 2.5)).toBeCloseTo(1);
    expect(getVisualPlaybackRateAtTime(segment, 3.5)).toBeCloseTo(1);
    expect(shouldUseNativeVisualPlayback(segment, true, true)).toBe(false);
  });

  it('keeps an all-forward expanded ramp on native video playback', () => {
    const forward = {
      ...segment,
      duration: 2,
      vibedevTimeRemapRuntime: {
        duration: 2,
        segments: [{
          kind: 'play',
          sourceInSeconds: 0,
          sourceOutSeconds: 0.5,
          durationSeconds: 1,
          rate: 0.5,
          reverse: false,
        }, {
          kind: 'play',
          sourceInSeconds: 0.5,
          sourceOutSeconds: 2,
          durationSeconds: 1,
          rate: 1.5,
          reverse: false,
        }],
      },
    };

    expect(requiresTimelineDrivenVideoFrames(forward)).toBe(false);
    expect(getVisualSourceTime(forward, 0.5)).toBeCloseTo(0.25);
    expect(getVisualSourceTime(forward, 1.5)).toBeCloseTo(1.25);
    expect(getVisualPlaybackRateAtTime(forward, 1.5)).toBeCloseTo(1.5);
    expect(shouldUseNativeVisualPlayback(forward, true, true)).toBe(true);
    expect(shouldUseNativeVisualPlayback(forward, true, false)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { splitVisualSegmentState } from '../../../vendor/ai-video-editor/src/lib/timelineCutActions.js';
import { createTimelineDurationActions } from '../../../vendor/ai-video-editor/src/lib/timelineDurationActions.js';
import {
  getVisualSourceTime,
  shouldSeekPreviewVideoOnSegmentChange,
  resizeVisualSegmentDuration,
} from '../../../vendor/ai-video-editor/src/lib/visualEffects.js';

describe('upstream visual timeline resize', () => {
  it('compresses a split clip without breaking source continuity at the cut', () => {
    const source = {
      id: 'source',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      src: '/media/clip.mp4',
      type: 'video',
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      playbackRate: 1,
    };
    const [left, right] = splitVisualSegmentState(source, 4, 6);

    const resized = resizeVisualSegmentDuration(left, 2, { nextSegment: right });

    expect(resized.duration).toBeCloseTo(2);
    expect(resized.sourceDuration).toBeCloseTo(4);
    expect(resized.playbackRate).toBeCloseTo(2);
    expect(getVisualSourceTime(resized, resized.duration)).toBeCloseTo(right.sourceStart);
    expect(getVisualSourceTime(right, 0)).toBeCloseTo(right.sourceStart);
  });

  it('repairs the source span previously lost by resizing the left half of a split', () => {
    const right = {
      id: 'right',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      src: '/media/clip.mp4',
      type: 'video',
      duration: 8.8,
      sourceStart: 1.2,
      sourceDuration: 8.8,
      playbackRate: 1,
    };
    const corruptedLeft = {
      ...right,
      id: 'left',
      duration: 0.5,
      sourceStart: 0,
      sourceDuration: 0.5,
    };

    const resized = resizeVisualSegmentDuration(corruptedLeft, 0.6, { nextSegment: right });

    expect(resized.sourceDuration).toBeCloseTo(1.2);
    expect(resized.playbackRate).toBeCloseTo(2);
    expect(getVisualSourceTime(resized, resized.duration)).toBeCloseTo(right.sourceStart);
  });

  it('does not infer a source boundary from an unrelated following clip', () => {
    const resized = resizeVisualSegmentDuration({
      id: 'left',
      assetId: 'asset-1',
      src: '/media/one.mp4',
      type: 'video',
      duration: 4,
      sourceStart: 2,
      sourceDuration: 4,
      playbackRate: 1,
    }, 2, {
      nextSegment: {
        id: 'right',
        assetId: 'asset-2',
        src: '/media/two.mp4',
        type: 'video',
        duration: 6,
        sourceStart: 8,
        sourceDuration: 6,
        playbackRate: 1,
      },
    });

    expect(resized.sourceDuration).toBeCloseTo(4);
    expect(resized.playbackRate).toBeCloseTo(2);
  });

  it('trims the source without changing playback speed for the timeline shorter button', () => {
    let committed: Array<Record<string, unknown>> = [];
    const action = createTimelineDurationActions({
      selectedTrack: 'image',
      trackLocks: { image: false },
      imageSrc: '/media/clip.mp4',
      visualSegments: [{
        id: 'left',
        assetVersionId: 'version-1',
        type: 'video',
        duration: 2,
        sourceStart: 0,
        sourceDuration: 2,
        playbackRate: 1,
      }, {
        id: 'right',
        assetVersionId: 'version-1',
        type: 'video',
        duration: 8,
        sourceStart: 2,
        sourceDuration: 8,
        playbackRate: 1,
      }],
      selectedVisualSegmentId: 'left',
      selectedVisualSegmentIndex: 0,
      currentVisualSegmentIndex: 0,
      commitVisualSegments(next: Array<Record<string, unknown>>) { committed = next; },
      notify() {},
    });

    action(-1);

    expect(committed[0]?.duration).toBeCloseTo(1);
    expect(committed[0]?.sourceDuration).toBeCloseTo(1);
    expect(committed[0]?.playbackRate).toBeCloseTo(1);
  });

  it('does not seek backwards when playback crosses a continuous split boundary', () => {
    const source = {
      id: 'source',
      assetVersionId: 'version-1',
      src: '/media/clip.mp4',
      type: 'video',
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      playbackRate: 1,
    };
    const [left, right] = splitVisualSegmentState(source, 4, 6);
    const shortenedLeft = resizeVisualSegmentDuration(left, 2, { nextSegment: right });

    expect(shouldSeekPreviewVideoOnSegmentChange(shortenedLeft, right, true)).toBe(false);
    expect(shouldSeekPreviewVideoOnSegmentChange(shortenedLeft, right, false)).toBe(true);
  });

  it('seeks at non-contiguous, cross-source, and frame-driven boundaries', () => {
    const left = {
      id: 'left',
      assetVersionId: 'version-1',
      src: '/media/clip.mp4',
      type: 'video',
      duration: 2,
      sourceStart: 0,
      sourceDuration: 4,
      playbackRate: 2,
    };

    expect(shouldSeekPreviewVideoOnSegmentChange(left, {
      ...left,
      id: 'gap',
      sourceStart: 5,
    }, true)).toBe(true);
    expect(shouldSeekPreviewVideoOnSegmentChange(left, {
      ...left,
      id: 'other',
      assetVersionId: 'version-2',
      src: '/media/other.mp4',
      sourceStart: 4,
    }, true)).toBe(true);
    expect(shouldSeekPreviewVideoOnSegmentChange(left, {
      ...left,
      id: 'refreshed-url',
      src: '/media/refreshed-clip.mp4',
      sourceStart: 4,
    }, true)).toBe(true);
    expect(shouldSeekPreviewVideoOnSegmentChange(left, {
      ...left,
      id: 'reverse',
      sourceStart: 4,
      vibedevTimeRemapRuntime: {
        duration: 2,
        segments: [{ kind: 'range', durationSeconds: 2, reverse: true }],
      },
    }, true)).toBe(true);
  });
});

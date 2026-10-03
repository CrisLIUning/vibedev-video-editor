// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  applyVisualBackfill,
  mergeVisualBackfill,
  needsVisualBackfill,
  visualBackfillKey,
  visualBackfillTargets,
} from '../../../vendor/ai-video-editor/src/lib/hostVisualBackfill.js';
import lifecycleSource from '../../../vendor/ai-video-editor/src/hooks/useEditorLifecycle.js?raw';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';

// Field report (2026-09-03): a video the agent put on the timeline showed the
// same first frame across the whole clip and gave no sense of position, while
// the same file dragged in showed a real frame strip.
//
// Read back from the user's own database, the placed clip was:
//   duration 10.125, sourceStart 0, sourceDuration 10.125   ← correct
//   width 0, height 0, no trackFrames, no thumbnail          ← never measured
//
// So the seek arithmetic was never wrong. `projectCommandEngine.importAsset`
// builds a clip from the command payload, and nothing has decoded the media;
// the drag path builds one from an asset the editor already measured. With no
// frames and no thumbnail the timeline falls back to a single stretched
// `<video>`, which is why every point along the clip showed frame 0.

interface Clip extends Record<string, unknown> {
  id: string;
  type: string;
  src: string;
  duration: number;
  sourceDuration: number;
  width: number;
  height: number;
  trackFrames?: readonly string[];
  trackFrameDuration?: number;
}

/** A clip as an agent placement delivers it. */
function placedClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_test_001',
    type: 'video',
    src: '/api/projects/p/raw/production/assets/asset-1/v1.mp4',
    name: '试片成片',
    duration: 10.125,
    sourceStart: 0,
    sourceDuration: 10.125,
    width: 0,
    height: 0,
    ...overrides,
  };
}

/** A clip as the drag path delivers it — already measured. */
function draggedClip(overrides: Partial<Clip> = {}): Clip {
  return placedClip({
    id: 'clip-dragged',
    width: 1920,
    height: 1080,
    trackFrames: ['data:image/webp;base64,aaa', 'data:image/webp;base64,bbb'],
    trackFrameDuration: 10.125,
    ...overrides,
  });
}

describe('needsVisualBackfill', () => {
  it('recognises a placed clip as unmeasured', () => {
    expect(needsVisualBackfill(placedClip())).toBe(true);
  });

  it('leaves a dragged clip alone — it was measured on the way in', () => {
    expect(needsVisualBackfill(draggedClip())).toBe(false);
  });

  it('measures a clip missing only one of the two', () => {
    expect(needsVisualBackfill(draggedClip({ trackFrames: [] }))).toBe(true);
    expect(needsVisualBackfill(draggedClip({ width: 0 }))).toBe(true);
  });

  it('never touches an image, or a clip with no source to read', () => {
    expect(needsVisualBackfill(placedClip({ type: 'image' }))).toBe(false);
    expect(needsVisualBackfill(placedClip({ src: '' }))).toBe(false);
    expect(needsVisualBackfill(null)).toBe(false);
  });
});

describe('visualBackfillTargets', () => {
  it('says which halves of the measurement are still needed', () => {
    const [target] = visualBackfillTargets([placedClip()]);
    expect(target).toMatchObject({ id: 'clip_test_001', needsFrames: true, needsSize: true });
    // sourceDuration is the length of media the clip actually spans.
    expect(target!.duration).toBe(10.125);
  });

  it('skips a clip already attempted, so a failed read is not retried forever', () => {
    const clip = placedClip();
    const attempted = new Set([visualBackfillKey(clip)]);
    expect(visualBackfillTargets([clip], attempted)).toHaveLength(0);
  });

  it('re-measures when the clip keeps its id but points at new media', () => {
    const clip = placedClip();
    const attempted = new Set([visualBackfillKey(clip)]);
    expect(visualBackfillTargets([placedClip({ src: '/raw/v2.mp4' })], attempted)).toHaveLength(1);
  });
});

describe('mergeVisualBackfill', () => {
  it('fills both halves for a placed clip', () => {
    const merged = mergeVisualBackfill(placedClip(), {
      width: 1920,
      height: 1080,
      trackFrames: ['a', 'b', 'c'],
    });
    expect(merged).toMatchObject({ width: 1920, height: 1080, trackFrames: ['a', 'b', 'c'] });
    expect(merged.trackFrameDuration).toBe(10.125);
  });

  it('never overwrites an authored value — a trim or repair outranks the media', () => {
    const trimmed = draggedClip({ width: 640, height: 360 });
    const merged = mergeVisualBackfill(trimmed, {
      width: 1920,
      height: 1080,
      trackFrames: ['fresh'],
    });
    expect(merged).toBe(trimmed);
  });

  it('is total: a measurement that read nothing changes nothing', () => {
    const clip = placedClip();
    expect(mergeVisualBackfill(clip, {})).toBe(clip);
    expect(mergeVisualBackfill(clip, { width: 0, height: 0, trackFrames: [] })).toBe(clip);
    expect(mergeVisualBackfill(clip, null)).toBe(clip);
  });
});

describe('applyVisualBackfill', () => {
  it('touches only the clip that was measured', () => {
    const other = draggedClip({ id: 'clip-other' });
    const next = applyVisualBackfill([placedClip(), other], 'clip_test_001', {
      width: 1920,
      height: 1080,
      trackFrames: ['a'],
    });
    expect(next[0]).toMatchObject({ width: 1920, trackFrames: ['a'] });
    // Identity preserved, so the untouched clip does not re-render or re-analyse.
    expect(next[1]).toBe(other);
  });

  it('returns the same array when nothing changed, so no render is caused', () => {
    const segments = [draggedClip()];
    expect(applyVisualBackfill(segments, 'clip-dragged', { width: 1920, height: 1080 })).toBe(segments);
    expect(applyVisualBackfill(segments, 'missing', { width: 1 })).toBe(segments);
    expect(applyVisualBackfill(segments, '', { width: 1 })).toBe(segments);
  });
});

describe('the editor runs the backfill', () => {
  it('App wires the hook', () => {
    expect(appSource).toContain('useHostVisualBackfill(');
  });
});

// Same field report: typing in the editor and pressing Backspace to fix a typo
// deleted a clip instead. The guard on the one shortcut that destroys a clip was
// the weakest in the editor — it hand-rolled `target.tagName` while Timeline.jsx
// used the shared `isEditorTextEntryTarget`, and it never checked `isComposing`,
// which is exactly the state a Chinese IME is in while composing.
describe('the delete shortcut uses the shared focus guard', () => {
  it('asks the shared helper instead of hand-rolling a tagName check', () => {
    expect(lifecycleSource).toContain('isEditorTextEntryTarget(event.target)');
    expect(lifecycleSource).not.toMatch(/target\.tagName === "INPUT"/);
  });

  it('stands down mid-composition', () => {
    expect(lifecycleSource).toContain('event.isComposing');
  });
});

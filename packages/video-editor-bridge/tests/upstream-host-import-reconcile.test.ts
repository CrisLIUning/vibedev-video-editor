import { describe, expect, it } from 'vitest';

import { createHostFieldGate } from '../../../vendor/ai-video-editor/src/lib/hostImportReconciler.js';
import projectFilesSource from '../../../vendor/ai-video-editor/src/hooks/useProjectFiles.js?raw';

// Field report (2026-09-03): "在某些输入框输入内容 也经常会被回退" — text typed
// into editor fields kept rolling back.
//
// Same source as the deleted clip that came back. The host re-imports the WHOLE
// project whenever its document changes, and its document changes for reasons
// the person did not cause: the daemon commits an `asset.place_version` for
// every generated asset. That import replaced all forty-odd pieces of editor
// state, so a refresh caused by one generated clip reverted every unrelated
// setting the person had touched — and reset the playhead and threw away every
// vision analysis on the way past.
//
// "The document changed" is not "everything changed". Remembering the payload of
// the last import gives a base, which makes this an ordinary three-way
// reconcile: a field where theirs equals base is one the host did not touch, so
// the editor's value stands.

const BASE = {
  script: '第一版',
  volume: 1,
  ratioId: '16:9',
  audioSegments: [{ id: 'a' }],
  trackLocks: { image: false },
};

describe('createHostFieldGate', () => {
  const hostRefresh = { hostDocument: true };

  it('skips a field the host did not touch, so the local value survives', () => {
    const incoming = { ...BASE, audioSegments: [{ id: 'a' }, { id: 'b' }] };
    const changed = createHostFieldGate(hostRefresh, incoming, BASE);
    // The refresh carried a new voice clip and nothing else.
    expect(changed('audioSegments')).toBe(true);
    expect(changed('script')).toBe(false);
    expect(changed('volume')).toBe(false);
    expect(changed('ratioId')).toBe(false);
    expect(changed('trackLocks')).toBe(false);
  });

  it('applies a field the host did change — that is the point of a refresh', () => {
    const changed = createHostFieldGate(hostRefresh, { ...BASE, script: '第二版' }, BASE);
    expect(changed('script')).toBe(true);
  });

  it('compares by value, not identity', () => {
    const changed = createHostFieldGate(
      hostRefresh,
      { ...BASE, trackLocks: { image: false }, audioSegments: [{ id: 'a' }] },
      BASE,
    );
    expect(changed('trackLocks')).toBe(false);
    expect(changed('audioSegments')).toBe(false);
  });

  it('answers true when any one of several fields moved', () => {
    const changed = createHostFieldGate(hostRefresh, { ...BASE, volume: 0.5 }, BASE);
    expect(changed('script', 'volume')).toBe(true);
    expect(changed('script', 'ratioId')).toBe(false);
  });

  it('applies everything when the person opened a project — they asked for it', () => {
    const changed = createHostFieldGate({ hostDocument: false }, BASE, BASE);
    expect(changed('script')).toBe(true);
    expect(changed('volume')).toBe(true);
  });

  it('applies everything on the first import, with no base to compare against', () => {
    expect(createHostFieldGate(hostRefresh, BASE, null)('script')).toBe(true);
    expect(createHostFieldGate(hostRefresh, BASE, undefined)('script')).toBe(true);
  });

  it('treats a field absent on both sides as untouched', () => {
    expect(createHostFieldGate(hostRefresh, BASE, BASE)('somethingNew')).toBe(false);
  });
});

describe('the import applies the gate rather than replacing everything', () => {
  /** The import body — where the wholesale replacement used to live. */
  const importBody = projectFilesSource.slice(
    projectFilesSource.indexOf('const handleImportProject'),
    projectFilesSource.indexOf('return { getProjectSnapshot'),
  );

  it('builds a gate from the payload of the last import', () => {
    expect(importBody).toContain('createHostFieldGate(importContext, data, hostProjectBaselineRef.current)');
    // Advanced only after every setter ran, so a throw halfway does not leave a
    // base claiming the editor already holds this payload.
    expect(importBody.indexOf('hostProjectBaselineRef.current = data'))
      .toBeGreaterThan(importBody.indexOf('deps.setShowFileMenu(false)'));
  });

  it.each([
    ['script', /hostChanged\("script"\) && !typing\) deps\.setScript/],
    ['volume', /hostChanged\("volume"\)\) deps\.setVolume/],
    ['ratio', /hostChanged\("ratioId"\)\) deps\.setRatioId/],
    ['caption style', /hostChanged\("captionStyle"\)\) deps\.setCaptionStyle/],
    ['track locks', /hostChanged\("trackLocks"\)\) deps\.setTrackLocks/],
    ['timeline zoom', /hostChanged\("timelineZoom"\)\) deps\.setTimelineZoom/],
    ['visual segments', /hostChanged\("visualSegments"\)\) \{/],
    ['overlays', /hostChanged\("visualOverlaySegments"\)\) \{/],
    ['stickers', /hostChanged\("stickerSegments"\)\) deps\.setStickerSegments/],
  ])('%s is applied only when the host moved it', (_name, pattern) => {
    expect(importBody).toMatch(pattern);
  });

  it('does not re-decode a media track the host left alone', () => {
    // Each of these branches revokes blob URLs and decodes waveforms; entering
    // one for an untouched track throws away the person's clips for nothing.
    expect(importBody).toContain('const audioChanged = hostChanged("audioSegments", "audioDuration")');
    expect(importBody).toContain('if (audioChanged) deps.audioSegments.forEach(');
    expect(importBody).toContain('const sourceAudioChanged = hostChanged(');
    expect(importBody).toContain('const musicChanged = hostChanged(');
    expect(importBody).toContain('const restoredMusic = !musicChanged ? null :');
  });

  it('leaves the playhead and the vision analyses alone on a refresh', () => {
    expect(importBody).toContain('if (!hostRefresh) { deps.setCurrentTime(0); deps.clearAllVisionState(); }');
    expect(importBody).toContain('if (!hostRefresh) deps.setTimelineHorizon(');
  });
});

import { describe, expect, it } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import projectFilesSource from '../../../vendor/ai-video-editor/src/hooks/useProjectFiles.js?raw';

/**
 * What the vendored editor owes the host, pinned against its own source.
 *
 * Three field reports from 剪五期 (2026-09-06/07), each one a host write the
 * editor undid or a host question it answered wrong on load: a music bed
 * dropped by a half-finished import, a revision written on every open that
 * carried nothing but a decoded waveform, and every spoken line reported as
 * a failure because the outcome read the wrong link. None of them shows up
 * in the bridge's own types — they live in the vendored App and its hooks —
 * so they are pinned here, where an upstream refresh has to look.
 */
describe('what the editor saves back for the host', () => {
  it('keeps the view model out of the cut: a selected clip\'s duration is not project data', () => {
    // `audioDuration` is `selectedAudioSegment?.duration` in useTimelineModel.
    // Saving it wrote a revision on every open (the cut's own value is the
    // audio track's end, which `asset.import` maintains) and dirtied the
    // document when someone merely clicked another clip.
    const snapshot = projectFilesSource.slice(projectFilesSource.indexOf('const getProjectSnapshot'), projectFilesSource.indexOf('const handleExportProject'));
    expect(snapshot).not.toContain('audioDuration: deps.audioDuration');
    // Still read on import, and still the gate for restoring the voice track.
    expect(projectFilesSource).toContain('hostChanged("audioSegments", "audioDuration")');
  });

  it('strips the decoded waveform from the music track, the way it already did for the voice track', () => {
    // Field report (2026-09-07, 剪五期): opening a cut that carried a music
    // bed wrote a new revision every time, whose only change was ~120 peak
    // values the import recomputes from the blob anyway. Both audio tracks
    // must leave the waveform behind.
    expect(projectFilesSource).toContain('const audioSegments = deps.audioSegments.map(({ blob, url, peaks, ...segment }) => segment);');
    expect(projectFilesSource).toContain('const musicSegments = deps.musicSegments.map(({ blob, url, peaks, ...segment }) => segment);');
    const snapshot = projectFilesSource.slice(projectFilesSource.indexOf('const getProjectSnapshot'), projectFilesSource.indexOf('const handleExportProject'));
    expect(snapshot).toContain('musicSegments,');
    expect(snapshot).not.toContain('musicSegments: deps.musicSegments');
  });
});

describe('the editor\'s voice, as the host reads its outcome', () => {
  it('counts a caption spoken when either link is set — a generated clip lands detached', () => {
    // Reading only `audioSegmentId` reported a failure for every line that
    // actually worked: `commitAudio` writes `detachedAudioSegmentId`.
    expect(appSource).toContain('const clipId = spoken?.audioSegmentId || spoken?.detachedAudioSegmentId;');
  });

  it('links the caption to the voice inside the editor, before the save the host would race', () => {
    // Linking from the host afterwards read a document the editor had not
    // saved yet, and the state it applied wiped the second line's link.
    const shim = appSource.slice(appSource.indexOf('generateVoiceover: async (captionId)'), appSource.indexOf('updateAuthorizedAssets: (assets)'));
    expect(shim).toContain('after.setCaptionSegments((segments) => segments.map((item) => item.id === captionId');
    expect(shim).toContain('audioSegmentId: clipId, detachedAudioSegmentId: ""');
    expect(appSource).toContain('hostVoiceRef.current = { generateVoiceover, captionSegments, status, statusText, setCaptionSegments };');
  });
});

describe('an import the host asked for', () => {
  it('rethrows, so a half-loaded editor is never marked ready and autosaved back', () => {
    // Upstream swallows every import failure and notifies. For the host's own
    // document that turned "half the tracks loaded" into "half the cut saved":
    // the bridge, told nothing, set ready and took the next snapshot.
    expect(projectFilesSource).toContain('if (importContext.hostDocument === true) throw error;');
    const tail = projectFilesSource.slice(projectFilesSource.indexOf('无法读取工程文件'));
    expect(tail.indexOf('throw error')).toBeLessThan(tail.indexOf('projectFileInputRef.current.value'));
  });
});

describe('the import hook gets every dependency it reads', () => {
  it('finds each deps.<name> the hook uses in the App\'s useProjectFiles call', () => {
    const used = [...new Set([...projectFilesSource.matchAll(/\bdeps\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!))].sort();
    expect(used.length).toBeGreaterThan(50);
    const start = appSource.indexOf('= useProjectFiles({');
    expect(start).toBeGreaterThan(0);
    const call = appSource.slice(start, appSource.indexOf('});', start));
    const passed = new Set([...call.matchAll(/\b([A-Za-z0-9_]+)\s*(?=[,:}\n])/g)].map((match) => match[1]!));
    const missing = used.filter((name) => !passed.has(name));
    expect(missing).toEqual([]);
  });
});

it('hands the source identity setter to the audio actions as well as the import hook', () => {
  const call = appSource.match(/createAudioTrackActions\(\{([\s\S]*?)\n  \}\);/)?.[1];
  expect(call).toContain('setSourceAudioSource');
});

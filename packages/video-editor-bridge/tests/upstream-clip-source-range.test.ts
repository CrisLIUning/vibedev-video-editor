import { expect, it } from 'vitest';
import { sliceClipSource, trimClipDuration, trimClipStart, trimClipRange } from '../../../vendor/ai-video-editor/src/lib/clipSourceRange.js';
import { getLinkedSourceAudioSegments } from '../../../vendor/ai-video-editor/src/lib/sourceAudioMapping.js';
import { getFfmpegRenderMediaRequirements } from '../../../vendor/ai-video-editor/src/lib/projectRenderPlan.js';
import { getVisualSourceTime } from '../../../vendor/ai-video-editor/src/lib/visualEffects.js';
import { getSampledVideoTrackFrames } from '../../../vendor/ai-video-editor/src/lib/videoTrackFrames.js';
import { executeVideoEditorCommandPlan, type JsonValue } from '../src/index.js';
const applyCommandPlan = (project: Record<string, JsonValue>, plan: Parameters<typeof executeVideoEditorCommandPlan>[1]) => {
 const result = executeVideoEditorCommandPlan({format:'timeline-studio-archive',version:3,project,media:{}},plan);
 return {...result, project: result.ok ? result.document.project as typeof project : project};
};
import { previewPlaybackRate } from '../../../vendor/ai-video-editor/src/hooks/useMediaSync.js';

const curve = (smooth: boolean) => ({ id:'clip', type:'video', duration:10, sourceStart:2, sourceDuration:10, playbackRate:1, speedCurve:{ enabled:true, smooth, points:[{progress:0,rate:.5},{progress:1,rate:2}] } });
it.each([true,false])('keeps exact source mapping after repeated curved cuts, smooth=%s', smooth => {
 const original=curve(smooth);
 const right=sliceClipSource(original,5,10);
 const middle=sliceClipSource(right,1,4);
 for(let t=0;t<=3;t+=.25) expect(getVisualSourceTime(middle,t)).toBeCloseTo(getVisualSourceTime(original,6+t),9);
 expect(right.sourceStart).toBeCloseTo(getVisualSourceTime(original,5),9);
});
it('native split and trim share the curved source mapping with preview',()=>{
 const original=curve(true);
 const result=applyCommandPlan({visualSegments:[original]}, {schemaVersion:1,baseRevision:0,operations:[{id:'split',type:'visual.split',clipId:'clip',at:5,rightClipId:'right'},{id:'trim',type:'visual.trim',clipId:'right',sourceIn:getVisualSourceTime(original,6),sourceOut:getVisualSourceTime(original,9)}]});
 expect(result.ok).toBe(true);if(!result.ok)return;
 const right=(result.project.visualSegments as Array<Record<string, unknown>>)[1]!;
 expect(right.duration).toBeCloseTo(3,8);
 for(let t=0;t<=3;t+=.25) expect(getVisualSourceTime(right,t)).toBeCloseTo(getVisualSourceTime(original,6+t),8);
});
it('edge trim keeps speed and can restore the available source without modifying saved input',()=>{
 const original={id:'v',type:'video',duration:10,sourceStart:3,sourceDuration:20,playbackRate:2};
 const trimmed=trimClipDuration(original,4);
 expect(trimmed).toMatchObject({duration:4,sourceDuration:8,playbackRate:2,sourceStart:3});
 expect(trimClipDuration(trimmed,99)).toMatchObject({duration:10,sourceDuration:20,playbackRate:2});
 expect(original.duration).toBe(10);
});
it('native audio resize keeps its source duration inside the shortened clip',()=>{
 const result=applyCommandPlan({audioSegments:[{id:'a',start:0,duration:10,sourceStart:2,sourceDuration:20,playbackRate:2}]},{schemaVersion:1,baseRevision:0,operations:[{id:'resize',type:'timed.resize',track:'audio',clipId:'a',duration:2}]});
 expect(result.ok).toBe(true);if(result.ok)expect((result.project.audioSegments as Array<Record<string, unknown>>)[0]).toMatchObject({duration:2,sourceDuration:4,sourceStart:2,playbackRate:2});
});
it('filmstrip samples the same curved source positions as playback, including a split half',()=>{
 const frames=Array.from({length:1201},(_,i)=>({sourceTime:i/100,src:'frame-'+i}));
 const segment=sliceClipSource(curve(false),5,10);
 const result=getSampledVideoTrackFrames(frames,5,segment);
 result.forEach((frame,i)=>expect(Math.abs(frame.sourceTime-getVisualSourceTime(curve(false),5+i+.5))).toBeLessThanOrEqual(.006));
});
it('recovers a delayed video clock with bounded native speed, without seeking or changing authored speed',()=>{
 const video={paused:false,seeking:false,readyState:4,currentTime:10};
 expect(previewPlaybackRate(video,10.3,1)).toBe(1.25);
 expect(video.currentTime).toBe(10);
 expect(previewPlaybackRate(video,10.01,1)).toBe(1);
 expect(previewPlaybackRate({...video,seeking:true},10.3,1)).toBe(1);
 expect(previewPlaybackRate(video,9.7,1)).toBe(.75);
});

it('keeps an overlay end fixed while trimming or restoring its left edge', () => {
  const clip = { id: 'overlay', type: 'video', start: 4, duration: 6, sourceStart: 2, sourceDuration: 12, playbackRate: 2 };
  expect(trimClipStart(clip, 6)).toMatchObject({ start: 6, duration: 4, sourceStart: 6, sourceDuration: 8 });
  expect(trimClipStart(clip, 0)).toMatchObject({ start: 3, duration: 7, sourceStart: 0, sourceDuration: 14 });
  expect(trimClipStart({ ...clip, type: 'image' }, 1)).toMatchObject({ start: 1, duration: 9 });
});
it('rebases image keyframes when splitting a still image', () => {
  expect(sliceClipSource({ type: 'image', duration: 6, keyframes: [{ time: 1 }, { time: 4 }] }, 3, 6).keyframes).toEqual([{ time: 1 }]);
});

it('native trim restores a previously saved source range without changing speed or unrelated tracks', () => {
  const original = { id: 'v', type: 'video', duration: 10, sourceStart: 2, sourceDuration: 20, playbackRate: 2 };
  const saved = JSON.parse(JSON.stringify(trimClipDuration(original, 4)));
  const captions = [{ id: 'manual', start: 12, end: 14, text: 'kept' }];
  const result = applyCommandPlan({ visualSegments: [saved], captionSegments: captions }, {
    schemaVersion: 1, baseRevision: 0,
    operations: [{ id: 'restore', type: 'visual.trim', clipId: 'v', sourceIn: 0, sourceOut: 20 }],
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect((result.project.visualSegments as Array<Record<string, unknown>>)[0]).toMatchObject({ sourceStart: 0, sourceDuration: 20, duration: 10, playbackRate: 2 });
    expect(result.project.captionSegments).toEqual(captions);
  }
});

it('rejects restoring past the known source and extending a curved range', () => {
  for (const segment of [trimClipDuration({ id: 'v', type: 'video', duration: 5, playbackRate: 1 }, 2), { ...curve(true), id: 'v' }]) {
    const result = applyCommandPlan({ visualSegments: [segment] }, {
      schemaVersion: 1, baseRevision: 0, operations: [{ id: 'bad', type: 'visual.trim', clipId: 'v', sourceIn: 0, sourceOut: 30 }],
    });
    expect(result.ok).toBe(false);
  }
});

it.each([0.5, 1, 2])('keeps preview, linked source audio and export ranges identical after both-edge trim at %sx', rate => {
  const original = { id: 'v', type: 'video', assetId: 'video', assetVersionId: 'v1', duration: 10 / rate,
    sourceStart: 0, sourceDuration: 10, sourceMediaDuration: 10, sourceAudioOffset: 12, playbackRate: rate };
  const trimmed = trimClipRange(original, 2 / rate, 7 / rate);
  const next = { ...original, id: 'next' };
  const visuals = [trimmed, next];
  const linked = getLinkedSourceAudioSegments(visuals, 'video', 22);
  const project = { visualSegments: visuals, sourceAudioLinked: true, sourceAudioDuration: 22,
    sourceAudioSource: { assetId: 'sound', assetVersionId: 'sound-v1', sourceUrl: '/sound.wav' } };
  const exported = getFfmpegRenderMediaRequirements(project).sourceAudio;
  expect(trimmed).toMatchObject({ duration: 5 / rate, sourceStart: 2, sourceDuration: 5, playbackRate: rate });
  expect(linked[0]).toMatchObject({ sourceStart: 14, sourceDuration: 5, duration: 5 / rate });
  expect(exported[0]).toMatchObject({ sourceStart: 14, sourceDuration: 5, duration: 5 / rate });
  expect(linked[1]?.start).toBeCloseTo(5 / rate);
  for (let time = 0; time <= 5 / rate; time += 0.25) {
    expect(getVisualSourceTime(trimmed, time)).toBeCloseTo(2 + time * rate);
  }
  const restored = trimClipRange(JSON.parse(JSON.stringify(trimmed)), -2 / rate, 8 / rate);
  expect(restored).toMatchObject({ sourceStart: 0, sourceDuration: 10, duration: 10 / rate, playbackRate: rate });
  expect(getFfmpegRenderMediaRequirements({ ...project, sourceAudioVolume: 0,
    visualSegments: visuals.map(v => ({ ...v, muted: true })) }).sourceAudio).toEqual([]);
});

it('restores a source window wholly beyond the currently trimmed interval', () => {
  const clip = { id: 'v', type: 'video', duration: 2, sourceStart: 0, sourceDuration: 2, sourceMediaDuration: 12, playbackRate: 1 };
  const result = applyCommandPlan({ visualSegments: [clip] }, { schemaVersion: 1, baseRevision: 0,
    operations: [{ id: 'later', type: 'visual.trim', clipId: 'v', sourceIn: 6, sourceOut: 9 }] });
  expect(result.ok).toBe(true);
  if (result.ok) expect((result.project.visualSegments as Array<Record<string, unknown>>)[0]).toMatchObject({ sourceStart: 6, sourceDuration: 3, duration: 3 });
});

it('does not extrapolate a curve while trimming its exact interior mapping', () => {
  const original = curve(true), trimmed = trimClipRange(original, 2, 7);
  for (let t = 0; t <= 5; t += 0.25) expect(getVisualSourceTime(trimmed, t)).toBeCloseTo(getVisualSourceTime(original, t + 2), 8);
  expect(trimClipRange(trimmed, -2, 10)).toBe(trimmed);
});

it('native trimming respects the visual track lock used by the editor', () => {
  const result = applyCommandPlan({ visualSegments: [{ id: 'v', type: 'video', duration: 10 }], trackLocks: { image: true } },
    { schemaVersion: 1, baseRevision: 0, operations: [{ id: 'trim', type: 'visual.trim', clipId: 'v', sourceIn: 1, sourceOut: 4 }] });
  expect(result).toMatchObject({ ok: false, code: 'TRACK_LOCKED' });
});

import { afterEach, expect, it, vi } from 'vitest';
import { syncTimelineAudioElement } from '../../../vendor/ai-video-editor/src/hooks/useMediaSync.js';
import { getFfmpegRenderMediaRequirements } from '../../../vendor/ai-video-editor/src/lib/projectRenderPlan.js';
import { shouldMuteEmbeddedVideoAudio } from '../../../vendor/ai-video-editor/src/lib/sourceAudioSync.js';
import { createPlaybackControls } from '../../../vendor/ai-video-editor/src/lib/playbackControls.js';

const media = (currentTime = 0) => ({ paused: false, currentTime, playbackRate: 1, play: vi.fn(), pause: vi.fn(), seeking: false });
afterEach(() => vi.restoreAllMocks());
it('jumps over deleted source content when adjacent linked clips share a playing element', () => {
 const audio = media(2.9);
 syncTimelineAudioElement(audio, {active:true,shouldPlay:true,expectedTime:2.9,segmentKey:'before'});
 audio.currentTime=3.1;
 syncTimelineAudioElement(audio, {active:true,shouldPlay:true,expectedTime:22.1,segmentKey:'after'});
 expect(audio.currentTime).toBe(22.1);
});
it('does not chase ordinary clock jitter inside the same clip', () => {
 const audio=media(2);
 syncTimelineAudioElement(audio,{active:true,shouldPlay:true,expectedTime:2,segmentKey:'same'});
 audio.currentTime=2.05;
 syncTimelineAudioElement(audio,{active:true,shouldPlay:true,expectedTime:2.08,segmentKey:'same'});
 expect(audio.currentTime).toBe(2.05);
 expect(audio.play).not.toHaveBeenCalled();
});
it('updates the source location when resuming after an inactive gap', () => {
 const audio=media(2);
 syncTimelineAudioElement(audio,{active:false,shouldPlay:true,expectedTime:0,segmentKey:'first'});
 audio.paused=true;
 syncTimelineAudioElement(audio,{active:true,shouldPlay:true,expectedTime:10,segmentKey:'second'});
 expect(audio.currentTime).toBe(10);expect(audio.play).toHaveBeenCalledOnce();
});
const project = () => ({visualSegments:[
 {id:'A',type:'video',assetId:'video',assetVersionId:'video-v1',duration:3,sourceStart:0,sourceDuration:3,sourceAudioOffset:0},
 {id:'B',type:'video',assetId:'video',assetVersionId:'video-v1',duration:2,sourceStart:4,sourceDuration:2},
 {id:'C',type:'video',assetId:'video',assetVersionId:'video-v1',duration:3,sourceStart:6,sourceDuration:3,sourceAudioOffset:9},
],sourceAudioSource:{assetId:'extracted',assetVersionId:'extracted-v1',sourceUrl:'/fixture.wav'},sourceAudioLinked:true,sourceAudioAssetId:'',sourceAudioDuration:18,sourceAudioVolume:.5});
it('native export includes both extracted and remaining embedded audio, preserving timeline positions',()=>{
 const p=project();const result=getFfmpegRenderMediaRequirements(p).sourceAudio;
 expect(result).toHaveLength(3);
 expect(result.find(s=>s.id==='B')).toMatchObject({start:3,sourceStart:4,duration:2,assetVersionId:'video-v1',volume:1});
 expect(result.find(s=>s.id==='C')).toMatchObject({start:5,sourceStart:15,assetVersionId:'extracted-v1',volume:.5});
});
it('explicitly muted video stays silent in preview and export',()=>{
 const p=project();Object.assign(p.visualSegments[1]!,{muted:true});
 expect(shouldMuteEmbeddedVideoAudio(p.visualSegments[1]!,{sourceAudioBlob:new Blob(),visualSegments:p.visualSegments})).toBe(true);
 expect(getFfmpegRenderMediaRequirements(p).sourceAudio.some(s=>s.id==='B')).toBe(false);
});
it('all-disabled linked clips never fall back to the entire extracted recording',()=>{
 const source=media();source.paused=true;
 const d={isPlaying:false,canPreview:true,currentTimeRef:{current:1},estimatedDuration:30,previewVideoRef:{current:null},audioSegmentRefs:{current:new Map()},audioSegments:[],sourceAudioRef:{current:source},sourceAudioUrl:'/fixture.wav',sourceAudioLinked:true,linkedSourceAudioSegments:[],sourceAudioDuration:90,sourceAudioStart:0,sourceAudioVolume:1,musicRef:{current:null},trackVisibility:{source:true},setIsPlaying:vi.fn()};
 createPlaybackControls(d).handlePlayToggle();expect(source.play).not.toHaveBeenCalled();
});

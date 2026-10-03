import { describe, expect, it } from 'vitest';

import { buildNativeTimelineFfmpegPlan } from '../src/index.js';

describe('upstream native timeline render plan bridge', () => {
  it('reuses the pinned upstream planner for a simple authorized timeline', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        ratioId: '16:9',
        visualSegments: [{
          id: 'visual-1',
          type: 'video',
          duration: 4,
          sourceStart: 2,
          playbackRate: 1,
        }],
        audioSegments: [],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual-1.mp4' }] },
      extractedFiles: new Map([['visuals/visual-1.mp4', 'C:/project/video one.mp4']]),
      settings: { width: 640, height: 360, frameRate: 30 },
    });

    expect(result).toMatchObject({
      duration: 4,
      width: 640,
      height: 360,
      frameRate: 30,
      hasAudio: false,
    });
    expect(result.args).toEqual(expect.arrayContaining([
      '-i',
      'C:/project/video one.mp4',
      '-filter_complex',
    ]));
  });

  it('normalizes native timeline audio to the authored LUFS target', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        ratioId: '16:9',
        targetLoudnessLufs: -16,
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 4 }],
        audioSegments: [{
          id: 'voice-1', start: 0, duration: 4, sourceStart: 0,
          sourceDuration: 4, playbackRate: 1, volume: 1,
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        audioSegments: [{ id: 'voice-1', path: 'audio/voice.wav' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['audio/voice.wav', 'C:/project/voice.wav'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(graph).toContain('aresample=48000[aout]');
    expect(result.targetLoudnessLufs).toBe(-16);
  });

  it('renders primary visual transforms and partial linear keyframes before timeline concatenation', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        ratioId: '16:9',
        visualSegments: [{
          id: 'visual-1', type: 'image', duration: 2,
          baseTransform: { x: -20, y: 10, scale: 0.8, rotation: 5, opacity: 0.75 },
          keyframes: [
            { time: 0.5, x: 0, scale: 1 },
            { time: 1.5, x: 20, scale: 1.2, rotation: 15, opacity: 1 },
          ],
        }],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }] },
      extractedFiles: new Map([['visuals/visual-1.png', 'C:/project/visual.png']]),
      settings: { width: 640, height: 360 },
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('color=c=black:s=640x360:r=30:d=2,format=rgba[vprimarybg0]');
    expect(graph).toContain("scale=w='max(2,trunc(iw*(if(lt(t,0.5),0.8,if(lte(t,1.5),(1+(0.2)*((t-0.5)/1)),1.2)))/2)*2)'");
    expect(graph).toContain("overlay=x='(W-w)/2+(if(lt(t,0.5),-20,if(lte(t,1.5),(0+(20)*((t-0.5)/1)),20)))/100*W'");
    expect(graph).toContain('[vprimarybg0][vprimarylayer0]overlay=');
    expect(graph).toContain('[v0]');
    expect(result.duration).toBe(2);
  });

  it('maps known upstream visual filter ids and rejects unknown filters', () => {
    const render = (filterId: string) => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2, filterId }],
        visualOverlaySegments: [{
          id: 'overlay-1', type: 'image', start: 0, duration: 1,
          filterId: 'effect-noir',
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/overlay-1.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual-1.png', 'C:/project/visual.png'],
        ['overlays/overlay-1.png', 'C:/project/overlay.png'],
      ]),
    });

    const bright = render('bright');
    const graph = bright.args[bright.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("lutrgb=r='val*1.08':g='val*1.08':b='val*1.08',eq=contrast=0.98:saturation=1.05");
    expect(graph).toContain('hue=s=0,eq=contrast=1.18');
    expect(() => render('future-filter')).toThrowError(expect.objectContaining({
      code: 'UNSUPPORTED_RENDER_FEATURE',
    }));
  });

  it('renders versioned allowlisted effects and rejects preview-only descriptors', () => {
    const render = (effects: Array<Record<string, unknown>>) => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2, effects }],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }] },
      extractedFiles: new Map([['visuals/visual-1.png', 'C:/project/visual.png']]),
    });

    const blur = render([{
      id: 'vibedev.blur', version: 1, parameters: { radius: 7.5 },
    }]);
    const graph = blur.args[blur.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('gblur=sigma=7.5');

    expect(() => render([{
      id: 'vibedev.preview-outline', version: 1, parameters: {},
    }])).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_RENDER_FEATURE' }));
  });

  it('renders a subject effect from a pinned immutable analysis mask', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'video', duration: 3,
          subjectEffect: {
            enabled: true,
            targetKind: 'person',
            outline: { enabled: true, color: '#32ead8', width: 5, opacity: 0.8, glow: 0 },
            background: { visible: true, mode: 'color', color: '#17252b', opacity: 1 },
          },
          vision: {
            hostAnalysis: {
              kind: 'video-analysis-record',
              analysisId: 'analysis-1',
              analysisKind: 'subject',
              artifacts: [{
                role: 'subject-mask', assetId: 'mask-asset', versionId: 'mask-version',
                sourceUrl: '/api/projects/project-1/raw/.vibedev/assets/mask.webm',
                mimeType: 'video/webm', sha256: 'a'.repeat(64),
              }],
            },
          },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.mp4' }],
        analyses: [{ id: 'analysis-1', path: 'analyses/mask.webm' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.mp4', 'C:/project/visual.mp4'],
        ['analyses/mask.webm', 'C:/project/mask.webm'],
      ]),
      settings: { width: 640, height: 360, frameRate: 30 },
    });

    expect(result.args).toEqual(expect.arrayContaining(['-i', 'C:/project/mask.webm']));
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('alphamerge');
    expect(graph).toContain('color=c=0x17252b:s=640x360');
    expect(graph).toContain('dilation=coordinates=255');
    expect(graph).toContain('0x32ead8');
  });

  it.each([
    ['cinematic depth', { cinematicDepth: { enabled: true, focus: 0.7, focusRange: 0.15, blur: 12 } }, 'gblur=sigma=12'],
    ['photo parallax', { photoParallax: { enabled: true, direction: 'orbit', strength: 0.6, speed: 1, zoom: 1.06, foregroundDepth: 0.68 } }, 'sin('],
  ])('renders %s from a pinned immutable depth map', (_name, effect, graphNeedle) => {
    const result = buildNativeTimelineFfmpegPlan({
      project: { visualSegments: [{
        id: 'visual-1', type: 'image', duration: 3, ...effect,
        depth: { hostAnalysis: {
          kind: 'video-analysis-record', analysisId: 'depth-1', analysisKind: 'depth',
          artifacts: [{ role: 'depth-map', assetId: 'depth-asset', versionId: 'depth-version',
            sourceUrl: '/api/projects/project-1/raw/analysis/depth.png', mimeType: 'image/png' }],
        } },
      }] },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        analyses: [{ id: 'depth-1', path: 'analyses/depth.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['analyses/depth.png', 'C:/project/depth.png'],
      ]),
      settings: { width: 640, height: 360, frameRate: 30 },
    });

    expect(result.args).toEqual(expect.arrayContaining(['-i', 'C:/project/depth.png']));
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain(graphNeedle);
    expect(graph).toContain('alphamerge');
  });

  it('renders authorized Sticker intervals with upstream geometry and keyframes', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 4 }],
        stickerSegments: [{
          id: 'sticker-1', start: 1, duration: 2, x: 75, y: 20,
          scale: 1.25, rotation: 15, opacity: 0.8, layer: 3,
          keyframes: [{ time: 0, x: 75 }, { time: 2, x: 40, opacity: 1 }],
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        stickers: [{ id: 'sticker-1', path: 'stickers/sticker.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['stickers/sticker.png', 'C:/project/sticker.png'],
      ]),
      settings: { width: 640, height: 360, frameRate: 30 },
    });

    expect(result.args).toEqual(expect.arrayContaining(['-loop', '1', '-t', '2', '-i', 'C:/project/sticker.png']));
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("enable='gte(t,1)*lt(t,3)'");
    expect(graph).toContain("overlay=x='");
    expect(graph).toContain('PI/180');
    expect(graph).toContain('alpha(X,Y)');
  });

  it('mixes a video clip\'s own sound in where the clip plays, when the host found a sound stream, outside the ducking key', () => {
    const project = {
      ratioId: '16:9',
      visualSegments: [
        { id: 'still-1', type: 'image', duration: 1 },
        { id: 'take-1', type: 'video', duration: 2, sourceStart: 3, sourceDuration: 4, playbackRate: 2 },
        { id: 'take-2', type: 'video', duration: 1, sourceStart: 0, sourceDuration: 1, playbackRate: 1, muted: true },
      ],
      audioSegments: [{ id: 'voice-1', start: 0, duration: 1, sourceStart: 0, sourceDuration: 1, playbackRate: 1, volume: 1 }],
      musicSegments: [{ id: 'bgm', start: 0, duration: 4, sourceStart: 0, sourceDuration: 4, playbackRate: 1, volume: 0.3, ducking: { enabled: true, speechBus: 'voiceover', threshold: 0.05, floorGain: 0.2, attackMs: 5, releaseMs: 300 } }],
    };
    const media = {
      visuals: [{ id: 'still-1', path: 'v/still.png' }, { id: 'take-1', path: 'v/take-1.mp4' }, { id: 'take-2', path: 'v/take-2.mp4' }],
      audioSegments: [{ id: 'voice-1', path: 'a/voice.wav' }],
      music: { id: 'bgm', path: 'a/bgm.mp3' },
      sourceAudioSegments: [{ id: 'take-1', path: 'v/take-1.mp4' }, { id: 'take-2', path: 'v/take-2.mp4' }],
    };
    const extractedFiles = new Map([
      ['v/still.png', '/p/still.png'], ['v/take-1.mp4', '/p/take-1.mp4'], ['v/take-2.mp4', '/p/take-2.mp4'],
      ['a/voice.wav', '/p/voice.wav'], ['a/bgm.mp3', '/p/bgm.mp3'],
    ]);
    const result = buildNativeTimelineFfmpegPlan({ project, media, extractedFiles });
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(result.hasAudio).toBe(true);
    // The clip's sound: trimmed to its source window, sped like the clip, delayed to where the clip plays (after the 1 s still).
    expect(graph).toContain('atrim=start=3:duration=4,asetpts=PTS-STARTPTS,atempo=2.000000,atrim=duration=2');
    expect(graph).toMatch(/adelay=1000:all=1,asetpts=N\/SR\/TB,apad,atrim=duration=4\[source0\]/);
    // A muted clip stays silent, and the source lane is mixed beside the ducked music, not through the key.
    expect(graph).not.toContain('[source1]');
    expect(graph).toContain('[voicepass][musicducked][source0]amix=inputs=3');
    // Without the host's word that the file has sound, nothing is asked of it.
    const unheard = buildNativeTimelineFfmpegPlan({ project: { ...project, musicSegments: [], audioSegments: [] }, media: { ...media, sourceAudioSegments: [] }, extractedFiles });
    expect(unheard.hasAudio).toBe(false);
  });

  it('lowers BGM envelopes and speech ducking before final loudness normalization', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 4 }],
        audioSegments: [{ id: 'voice-1', start: 0, duration: 4 }],
        musicSegments: [{
          id: 'music-1', start: 0, duration: 4, volume: 0.5,
          volumeEnvelope: [{ time: 0, gain: 0.25 }, { time: 2, gain: 1 }, { time: 4, gain: 0.5 }],
          ducking: { enabled: true, speechBus: 'voiceover', threshold: 0.05,
            floorGain: 0.2, attackMs: 5, releaseMs: 300 },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        audioSegments: [{ id: 'voice-1', path: 'audio/voice.wav' }],
        music: { id: 'music-1', path: 'audio/music.wav' },
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['audio/voice.wav', 'C:/project/voice.wav'],
        ['audio/music.wav', 'C:/project/music.wav'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("volume='if(lt(t,2)");
    expect(graph).toContain('sidechaincompress=threshold=0.05');
    expect(graph).toContain(':attack=5:release=300');
    expect(graph.indexOf('sidechaincompress=')).toBeLessThan(graph.indexOf('loudnorm='));
  });

  it('renders static color wheels and shortest-path color-grade keyframes', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'image', duration: 2,
          colorGrade: {
            temperature: 20,
            tint: -12,
            saturation: 18,
            shadows: { hue: 350, saturation: 30, luminance: -8 },
            midtones: { hue: 45, saturation: 20, luminance: 5 },
            highlights: { hue: 190, saturation: 15, luminance: 12 },
            offset: { hue: 280, saturation: 8, luminance: 3 },
          },
          keyframes: [
            { time: 0.5, 'colorGrade.shadows.hue': 350, 'colorGrade.temperature': 20 },
            { time: 1.5, 'colorGrade.shadows.hue': 10, 'colorGrade.temperature': -25 },
          ],
        }],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }] },
      extractedFiles: new Map([['visuals/visual-1.png', 'C:/project/visual.png']]),
      settings: { width: 640, height: 360 },
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("geq=r='");
    expect(graph).toContain('atan2(');
    expect(graph).toContain('sin(');
    expect(graph).toContain('cos(');
    expect(graph).toContain('if(lte(T,1.5)');
    expect(graph).toContain('(350+(20)*((T-0.5)/1))');
  });

  it('renders pinned clip animations as item-local transform expressions', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'image', duration: 2,
          animation: { in: { id: 'fade', duration: 0.5 } },
        }],
        visualOverlaySegments: [{
          id: 'overlay-1', type: 'image', start: 0.25, duration: 1,
          animation: { out: { id: 'slide-left', duration: 0.5 } },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/overlay-1.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual-1.png', 'C:/project/visual.png'],
        ['overlays/overlay-1.png', 'C:/project/overlay.png'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("if(lt(T,0.5),(1-pow(1-T/0.5,3)),1)");
    expect(graph).toContain("if(gt((t-0.25),0.5),-18*pow(((t-0.25)-0.5)/0.5,3),0)");
    expect(result.duration).toBe(2);
    expect(() => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'image', duration: 1,
          animation: { in: { id: 'future-bounce', duration: 0.5 } },
        }],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }] },
      extractedFiles: new Map([['visuals/visual-1.png', 'C:/project/visual.png']]),
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_RENDER_FEATURE' }));
  });

  it('renders timed static overlays with the upstream center-based transform', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2 }],
        visualOverlaySegments: [{
          id: 'overlay-1',
          type: 'image',
          start: 0.5,
          duration: 1,
          layer: 2,
          baseTransform: { x: 25, y: -20, scale: 0.3, rotation: 0, opacity: 0.75 },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/overlay-1.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual-1.png', 'C:/project/visual.png'],
        ['overlays/overlay-1.png', 'C:/project/overlay.png'],
      ]),
      settings: { width: 640, height: 360 },
    });

    expect(result.args).toEqual(expect.arrayContaining([
      '-i', 'C:/project/overlay.png',
    ]));
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("enable='between(t,0.5,1.5)'");
    expect(graph).toContain('colorchannelmixer=aa=0.75');
    expect(graph).toContain('overlay=x=(W-w)/2+160:y=(H-h)/2-72');
    expect(result.duration).toBe(2);
  });

  it('renders partial overlay keyframes with the upstream linear transform semantics', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2 }],
        visualOverlaySegments: [{
          id: 'overlay-1', type: 'image', start: 0.25, duration: 1.5,
          baseTransform: { x: -20, y: 10, scale: 0.25, rotation: 5, opacity: 0.8 },
          keyframes: [
            { time: 0.5, x: 10, scale: 0.5 },
            { time: 1.5, x: 30, scale: 1, rotation: 25, opacity: 0.4 },
          ],
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/overlay-1.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual-1.png', 'C:/project/visual.png'],
        ['overlays/overlay-1.png', 'C:/project/overlay.png'],
      ]),
      settings: { width: 640, height: 360 },
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("scale=w='max(2,trunc(iw*(if(lt(t,0.5),0.25,if(lte(t,1.5),(0.5+(0.5)*((t-0.5)/1)),1)))/2)*2)'");
    expect(graph).toContain("rotate=angle='PI/180*(if(lt(t,1.5),5,25))'");
    expect(graph).toContain("a='alpha(X,Y)*(if(lt(T,1.5),0.8,0.4))'");
    expect(graph).toContain("overlay=x='(W-w)/2+(if(lt((t-0.25),0.5),-20,if(lte((t-0.25),1.5),(10+(20)*(((t-0.25)-0.5)/1)),30)))/100*W'");
    expect(graph).toContain("y='(H-h)/2+(10)/100*H'");
    expect(result.duration).toBe(2);
  });

  it('renders a non-feathered circle overlay mask before canvas padding', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2 }],
        visualOverlaySegments: [{
          id: 'overlay-1', type: 'image', start: 0, duration: 2,
          baseTransform: { scale: 0.5 },
          mask: {
            type: 'circle', size: 100, centerX: 50, centerY: 50,
            feather: 0, inverted: false,
          },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/logo.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['overlays/logo.png', 'C:/project/logo.png'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(if(lte(sqrt(pow(X-W*0.5,2)+pow(Y-H*0.5,2))-min(W,H)*0.5,0),1,0))'");
    expect(graph.indexOf('geq=')).toBeLessThan(graph.lastIndexOf('pad=1280:720'));
  });

  it('renders feathered and inverted masks on primary and overlay visuals', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'image', duration: 2,
          mask: {
            type: 'rectangle', width: 70, height: 60,
            centerX: 45, centerY: 55, feather: 20, inverted: false,
          },
        }],
        visualOverlaySegments: [{
          id: 'overlay-1', type: 'image', start: 0, duration: 2,
          mask: {
            type: 'rounded', width: 80, height: 65, cornerRadius: 18,
            centerX: 50, centerY: 50, feather: 12, inverted: true,
          },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/logo.png' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['overlays/logo.png', 'C:/project/logo.png'],
      ]),
      settings: { width: 640, height: 360 },
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("alpha(X,Y)*(clip(");
    expect(graph).toContain("alpha(X,Y)*(1-(clip(");
    expect(graph).toContain('sqrt(pow(max(');
    expect(graph).toContain('color=c=black:s=640x360');
  });

  it('trims and retimes video overlays without extending the main timeline', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 3 }],
        visualOverlaySegments: [{
          id: 'overlay-video', type: 'video', sourceStart: 2,
          sourceDuration: 1, playbackRate: 2, start: 1, duration: 0.5,
          baseTransform: { scale: 0.4 },
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }],
        overlays: [{ id: 'overlay-video', path: 'overlays/overlay.mp4' }],
      },
      extractedFiles: new Map([
        ['visuals/visual-1.png', 'C:/project/visual.png'],
        ['overlays/overlay.mp4', 'C:/project/overlay.mp4'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('trim=start=2:duration=1,setpts=(PTS-STARTPTS)/2');
    expect(graph).toContain("enable='between(t,1,1.5)'");
    expect(result.duration).toBe(3);
  });

  it('renders upstream fade and wipe junctions without shortening or skipping the timeline', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        ratioId: '16:9',
        visualSegments: [
          { id: 'one', type: 'video', duration: 4, transition: { id: 'fade', duration: 0.5 } },
          { id: 'two', type: 'video', duration: 3 },
        ],
      },
      media: {
        visuals: [
          { id: 'one', path: 'visuals/one.mp4' },
          { id: 'two', path: 'visuals/two.mp4' },
        ],
      },
      extractedFiles: new Map([
        ['visuals/one.mp4', 'C:/project/one.mp4'],
        ['visuals/two.mp4', 'C:/project/two.mp4'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(result.duration).toBe(7);
    expect(graph).toContain('split=2');
    expect(graph).toContain('xfade=transition=fade:duration=0.5:offset=3.5');
    expect(graph).toContain('trim=duration=4');
    expect(graph).toContain('concat=n=2:v=1:a=0');
  });

  it('renders the faithful FFmpeg mappings for wipe-up, zoom and flash junctions', () => {
    const renderTransition = (id: string) => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [
          { id: 'one', type: 'video', duration: 2, transition: { id, duration: 0.4 } },
          { id: 'two', type: 'video', duration: 2 },
        ],
      },
      media: { visuals: [
        { id: 'one', path: 'visuals/one.mp4' },
        { id: 'two', path: 'visuals/two.mp4' },
      ] },
      extractedFiles: new Map([
        ['visuals/one.mp4', 'C:/project/one.mp4'],
        ['visuals/two.mp4', 'C:/project/two.mp4'],
      ]),
    });

    for (const [upstream, ffmpeg] of [
      ['wipe-up', 'wipeup'],
      ['zoom', 'zoomin'],
      ['flash', 'fadewhite'],
    ] as const) {
      const result = renderTransition(upstream);
      const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
      expect(graph).toContain(`xfade=transition=${ffmpeg}:duration=0.4:offset=1.6`);
      expect(result.duration).toBe(4);
    }
  });

  it('renders blur, center-split, and cyan-pulse glitch transitions with the fork semantics', () => {
    const renderTransition = (id: string) => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [
          { id: 'one', type: 'video', duration: 2, transition: { id, duration: 0.4 } },
          { id: 'two', type: 'video', duration: 2 },
        ],
      },
      media: { visuals: [
        { id: 'one', path: 'visuals/one.mp4' },
        { id: 'two', path: 'visuals/two.mp4' },
      ] },
      extractedFiles: new Map([
        ['visuals/one.mp4', 'C:/project/one.mp4'],
        ['visuals/two.mp4', 'C:/project/two.mp4'],
      ]),
    });

    const blurGraph = renderTransition('blur').args.join(' ');
    expect(blurGraph).toContain('xfade=transition=hblur:duration=0.4:offset=1.6');

    const splitGraph = renderTransition('split').args.join(' ');
    expect(splitGraph).toContain('xfade=transition=vertopen:duration=0.4:offset=1.6');

    const glitchGraph = renderTransition('glitch').args.join(' ');
    expect(glitchGraph).toContain('xfade=transition=custom');
    expect(glitchGraph).toContain('sin(P*PI*8)');
    expect(glitchGraph).toContain('234');
    expect(glitchGraph).toContain('217');
    expect(glitchGraph).toContain('53');
  });

  it('emits a safe UTF-8 ASS sidecar for visible default-font captions', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        ratioId: '16:9',
        captionsEnabled: true,
        captionSize: 16,
        captionPlacement: { x: 50, y: 78 },
        captionStyle: {
          fontId: 'default',
          textColor: '#f5fbff',
          backgroundColor: '#05080d',
          backgroundOpacity: 0.62,
          effect: 'normal',
        },
        visualSegments: [{ id: 'visual-1', type: 'video', duration: 4 }],
        captionSegments: [
          { id: 'caption-1', text: '你好，Agent\n保留 {结构} 和 100%', start: 0.25, end: 2.5, hidden: false },
          { id: 'hidden', text: 'do not render', start: 0, end: 1, hidden: true },
        ],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/one.mp4' }] },
      extractedFiles: new Map([['visuals/one.mp4', 'C:/project/one.mp4']]),
      settings: { width: 640, height: 360 },
    });

    expect(result.sidecars).toHaveLength(1);
    expect(result.sidecars?.[0]).toMatchObject({ filename: 'captions.ass' });
    expect(result.sidecars?.[0]?.content).toContain('Dialogue: 0,0:00:00.25,0:00:02.50');
    expect(result.sidecars?.[0]?.content).toContain('你好，Agent\\N保留 \\{结构\\} 和 100%');
    expect(result.sidecars?.[0]?.content).not.toContain('do not render');
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('subtitles=filename=captions.ass');
    expect(result.args).toEqual(expect.arrayContaining(['-map', '[vout]']));
  });

  it('renders the upstream neon caption preset as an ASS glow-compatible style', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2 }],
        captionsEnabled: true,
        captionStyle: {
          fontId: 'default',
          effect: 'neon',
          borderColor: '#35f0dd',
          borderWidth: 1,
          shadowOpacity: 0.45,
          backgroundOpacity: 0.18,
        },
        captionSegments: [{ id: 'caption', text: 'NEON', start: 0, end: 1 }],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/one.png' }] },
      extractedFiles: new Map([['visuals/one.png', 'C:/project/one.png']]),
      settings: { width: 640, height: 360 },
    });

    const ass = result.sidecars?.[0]?.content ?? '';
    expect(ass).toContain('Style: Default,Arial');
    expect(ass).toContain('&H00DDF035');
    expect(result.args[result.args.indexOf('-filter_complex') + 1])
      .toContain('subtitles=filename=captions.ass');
  });

  it('binds a verified downloadable caption font to ASS and libass fontsdir', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2 }],
        captionsEnabled: true,
        captionSegments: [{
          id: 'caption-1', text: '共享字体缓存', start: 0, end: 1.5,
          fontId: 'noto-sans-sc',
        }],
        captionStyle: { fontId: 'noto-sans-sc' },
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual-1.png' }] },
      extractedFiles: new Map([['visuals/visual-1.png', 'C:/project/visual.png']]),
      rendererResources: {
        captionFonts: {
          'noto-sans-sc': {
            path: 'C:/cache/noto-sans-sc.ttf',
          },
        },
      },
    } as never);

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('subtitles=filename=captions.ass:fontsdir=.');
    expect(result.sidecars).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filename: 'caption-font-noto-sans-sc.ttf',
        sourcePath: 'C:/cache/noto-sans-sc.ttf',
      }),
    ]));
    expect(result.sidecars?.find((item) => item.filename === 'captions.ass')?.content)
      .toContain('Style: Default,Noto Sans SC,');
  });

  it('renders only audible audio lanes and preserves clip fades', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 3 }],
        trackVisibility: { 'audio-1': false },
        audioSegments: [{
          id: 'voice', start: 0.25, duration: 2, sourceStart: 1,
          sourceDuration: 2, playbackRate: 1, volume: 0.5,
          fadeIn: 0.5, fadeOut: 0.75, lane: 0,
        }, {
          id: 'hidden-lane', start: 0, duration: 1, lane: 1,
        }, {
          id: 'muted', start: 2.5, duration: 0.5, muted: true, lane: 0,
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        audioSegments: [{ id: 'voice', path: 'audio/voice.wav' }],
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['audio/voice.wav', 'C:/project/voice.wav'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('afade=t=in:st=0:d=0.5');
    expect(graph).toContain('afade=t=out:st=1.25:d=0.75');
    expect(graph).toContain('volume=0.5');
    expect(graph).not.toContain('muted');
    expect(graph).not.toContain('hidden-lane');
    expect(result.hasAudio).toBe(true);
  });

  it('renders original, short-room, and long-hall spatial audio with upstream preset gains', () => {
    const render = (spatialEffect: string, spatialAmount: number) => {
      const result = buildNativeTimelineFfmpegPlan({
        project: {
          targetLoudnessLufs: -16,
          visualSegments: [{ id: 'visual-1', type: 'image', duration: 3 }],
          audioSegments: [{
            id: 'voice', start: 0, duration: 2,
            spatialEffect, spatialAmount,
          }],
        },
        media: {
          visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
          audioSegments: [{ id: 'voice', path: 'audio/voice.wav' }],
        },
        extractedFiles: new Map([
          ['visuals/visual.png', 'C:/project/visual.png'],
          ['audio/voice.wav', 'C:/project/voice.wav'],
        ]),
      });
      return result.args[result.args.indexOf('-filter_complex') + 1]!;
    };

    expect(render('original', 1)).not.toContain('[voice0spatialwet]');
    expect(render('hall', 0)).not.toContain('[voice0spatialwet]');

    const bedroom = render('bedroom', 0.5);
    expect(bedroom).toContain('[voice0source]asplit=2[voice0spatialdryin][voice0spatialwetin]');
    expect(bedroom).toContain('[voice0spatialdryin]volume=0.975[voice0spatialdry]');
    expect(bedroom).toContain('[voice0spatialwetin]adelay=6:all=1');
    expect(bedroom).toContain('lowpass=f=7200');
    expect(bedroom).toContain('volume=0.15[voice0spatialwet]');
    expect(bedroom).toContain('volume=0.99[voice0spatial]');

    const hall = render('hall', 1);
    expect(hall).toContain('[voice0spatialdryin]volume=0.86[voice0spatialdry]');
    expect(hall).toContain('[voice0spatialwetin]adelay=26:all=1');
    expect(hall).toContain('aecho=1:1:32|71|143|238|');
    expect(hall).toContain('lowpass=f=9800');
    expect(hall).toContain('volume=0.5[voice0spatialwet]');
    expect(hall).toContain('volume=0.86[voice0spatial]');
    expect(hall).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
  });

  it('does not replace an explicitly silent music volume with the default gain', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 2 }],
        musicVolume: 0,
        musicSegments: [{ id: 'music', start: 0, duration: 2 }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        music: { id: 'music', path: 'audio/music.wav' },
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['audio/music.wav', 'C:/project/music.wav'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(result.hasAudio).toBe(false);
    expect(result.args).toContain('-an');
    expect(graph).not.toContain('loudnorm');
    expect(graph).not.toContain('volume=0.35,');
  });

  it('loops an authorized BGM source through the requested timeline duration', () => {
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 3 }],
        musicSegments: [{
          id: 'music', start: 0, duration: 3, sourceStart: 0,
          sourceDuration: 1, playbackRate: 1, vibedevLoop: true,
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }],
        music: { id: 'music', path: 'audio/music.wav' },
      },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
        ['audio/music.wav', 'C:/project/music.wav'],
      ]),
    });

    expect(result.args).toEqual(expect.arrayContaining([
      '-stream_loop', '-1', '-i', 'C:/project/music.wav',
    ]));
    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[1:a]atrim=start=0:duration=3');
    expect(result.duration).toBe(3);
  });

  it('renders forward, freeze, and reverse time-remap steps with linked source audio', () => {
    const runtime = {
      duration: 4,
      segments: [{
        kind: 'play', sourceInSeconds: 0, sourceOutSeconds: 2,
        durationSeconds: 2, rate: 1, reverse: false,
      }, {
        kind: 'freeze', sourceSeconds: 2, durationSeconds: 1,
      }, {
        kind: 'play', sourceInSeconds: 2, sourceOutSeconds: 1,
        durationSeconds: 1, rate: 1, reverse: true,
      }],
    };
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'video', duration: 4,
          vibedevTimeRemapRuntime: runtime,
        }],
        visualOverlaySegments: [{
          id: 'overlay-1', type: 'video', start: 0, duration: 4,
          vibedevTimeRemapRuntime: runtime,
        }],
        audioSegments: [{
          id: 'source-audio', start: 0, duration: 4,
          vibedevTimeRemapRuntime: runtime,
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/source.mp4' }],
        overlays: [{ id: 'overlay-1', path: 'overlays/source.mp4' }],
        audioSegments: [{ id: 'source-audio', path: 'audio/source.mp4' }],
      },
      extractedFiles: new Map([
        ['visuals/source.mp4', 'C:/project/source.mp4'],
        ['overlays/source.mp4', 'C:/project/source.mp4'],
        ['audio/source.mp4', 'C:/project/source.mp4'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[0:v]split=3[vremap0step0in][vremap0step1in][vremap0step2in]');
    expect(graph).toContain('trim=start=1:duration=1,reverse,setpts=(PTS-STARTPTS)/1');
    expect(graph).toContain('trim=start=2:end=2.033333,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1');
    expect(graph).toContain('concat=n=3:v=1:a=0[vremap0]');
    expect(graph).toContain('[1:v]split=3[voverlayremap0step0in]');
    expect(graph).toContain('[2:a]asplit=2[voice0remapplay0in][voice0remapplay2in]');
    expect(graph).toContain('areverse,asetpts=PTS-STARTPTS,atempo=1.000000');
    expect(graph).toContain('anullsrc=r=48000:cl=stereo:d=1[voice0remapstep1]');
    expect(graph).toContain('concat=n=3:v=0:a=1[voice0remapsource]');
    expect(result.duration).toBe(4);
    expect(result.hasAudio).toBe(true);
  });

  it('renders fork-authored speed curves through the same remap lowering', () => {
    const speedCurve = {
      enabled: true,
      smooth: true,
      points: [{ progress: 0, rate: 0.5 }, { progress: 1, rate: 2 }],
    };
    const result = buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{
          id: 'visual-1', type: 'video', duration: 3,
          sourceStart: 1, sourceDuration: 3, speedCurve,
        }],
        audioSegments: [{
          id: 'source-audio', start: 0, duration: 3,
          sourceStart: 1, sourceDuration: 3, speedCurve,
        }],
      },
      media: {
        visuals: [{ id: 'visual-1', path: 'visuals/source.mp4' }],
        audioSegments: [{ id: 'source-audio', path: 'audio/source.mp4' }],
      },
      extractedFiles: new Map([
        ['visuals/source.mp4', 'C:/project/source.mp4'],
        ['audio/source.mp4', 'C:/project/source.mp4'],
      ]),
    });

    const graph = result.args[result.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('[0:v]split=24[vremap0step0in]');
    expect(graph).toContain('concat=n=24:v=1:a=0[vremap0]');
    expect(graph).toContain('[1:a]asplit=24[voice0remapplay0in]');
    expect(graph).toContain('concat=n=24:v=0:a=1[voice0remapsource]');
    expect(result.duration).toBe(3);
  });

  it('blocks unresolved migration warnings', () => {
    const render = (project: Record<string, unknown>) => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 3 }],
        ...project,
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }] },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
      ]),
    });

    expect(() => render({
      vibedevMigrationWarnings: [
        'bgm:music:automation-keyframes-require-native-fallback',
      ],
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_RENDER_FEATURE' }));
  });

  it('accepts the historical loop warning after native BGM looping became available', () => {
    expect(() => buildNativeTimelineFfmpegPlan({
      project: {
        visualSegments: [{ id: 'visual-1', type: 'image', duration: 3 }],
        vibedevMigrationWarnings: ['bgm:music:loop-requires-native-fallback'],
      },
      media: { visuals: [{ id: 'visual-1', path: 'visuals/visual.png' }] },
      extractedFiles: new Map([
        ['visuals/visual.png', 'C:/project/visual.png'],
      ]),
    })).not.toThrow();
  });

});

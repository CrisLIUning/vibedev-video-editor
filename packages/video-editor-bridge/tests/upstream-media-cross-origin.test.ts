import { afterEach, describe, expect, it, vi } from 'vitest';

import { mediaCrossOrigin } from '../../../vendor/ai-video-editor/src/lib/mediaCrossOrigin.js';
import editorOverlaysSource from '../../../vendor/ai-video-editor/src/components/EditorOverlays.jsx?raw';
import panelsSource from '../../../vendor/ai-video-editor/src/components/panels.jsx?raw';
import previewStageSource from '../../../vendor/ai-video-editor/src/components/PreviewStage.jsx?raw';
import timelineSource from '../../../vendor/ai-video-editor/src/components/Timeline.jsx?raw';
import mediaSource from '../../../vendor/ai-video-editor/src/lib/media.js?raw';
import personOutlineSource from '../../../vendor/ai-video-editor/src/lib/personOutlineAnalysis.js?raw';
import visionSource from '../../../vendor/ai-video-editor/src/lib/vision.js?raw';
import depthOfFieldSource from '../../../vendor/ai-video-editor/src/hooks/useDepthOfFieldAnalysis.js?raw';

// Field report (2026-09-03): every thumbnail in the media panel rendered as a
// broken image inside the packaged app — project files and host-generated
// assets alike. Measured in a running packaged app, same file, same URL:
//
//   <img src=…>                          → loaded, 1440x1000
//   <img src=… crossOrigin="anonymous">  → failed
//   drawImage + getImageData afterwards  → canvas NOT tainted
//
// The page origin there is `od://app`. Marking the request cross-origin is the
// only thing that makes the browser treat these same-origin asset URLs as CORS
// requests, and the daemon's origin guard rejects any non-http(s) Origin
// outright (403). So the attribute cost every asset thumbnail and bought
// nothing: same-origin sources never taint a canvas.
//
// A genuinely remote asset still needs it, hence a decision per source rather
// than deletion.

const ORIGIN = 'od://app';

function withOrigin(origin: string): void {
  vi.stubGlobal('location', { origin } as Location);
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mediaCrossOrigin', () => {
  it('does not mark same-origin asset urls, the case that was breaking', () => {
    withOrigin(ORIGIN);
    expect(mediaCrossOrigin('/api/projects/p1/raw/preview.png')).toBeUndefined();
    expect(mediaCrossOrigin('od://app/api/projects/p1/raw/preview.png')).toBeUndefined();
  });

  it('does not mark blob or data sources — they cannot taint a canvas', () => {
    withOrigin(ORIGIN);
    expect(mediaCrossOrigin('blob:od://app/8f1c-…')).toBeUndefined();
    expect(mediaCrossOrigin('data:image/png;base64,iVBORw0KGgo=')).toBeUndefined();
  });

  it('marks a genuinely remote http(s) asset, which does need CORS mode', () => {
    withOrigin('https://studio.example');
    expect(mediaCrossOrigin('https://cdn.example/clip.mp4')).toBe('anonymous');
    expect(mediaCrossOrigin('http://cdn.example/clip.mp4')).toBe('anonymous');
    expect(mediaCrossOrigin('https://studio.example/same.png')).toBeUndefined();
  });

  it('never marks a custom scheme — a CORS request there cannot succeed', () => {
    withOrigin(ORIGIN);
    expect(mediaCrossOrigin('od://other/thing.png')).toBeUndefined();
    expect(mediaCrossOrigin('file:///tmp/a.png')).toBeUndefined();
  });

  it('is total: empty, non-string and unparseable inputs decide "no"', () => {
    withOrigin(ORIGIN);
    expect(mediaCrossOrigin('')).toBeUndefined();
    expect(mediaCrossOrigin(undefined as unknown as string)).toBeUndefined();
    expect(mediaCrossOrigin('http://[bad')).toBeUndefined();
  });

  it('works with no document at all (worker / test), defaulting to no CORS', () => {
    vi.stubGlobal('location', undefined);
    expect(mediaCrossOrigin('/api/projects/p1/raw/preview.png')).toBeUndefined();
  });
});

describe('the editor asks per source instead of hardcoding the attribute', () => {
  const RENDERERS: ReadonlyArray<readonly [string, string]> = [
    ['EditorOverlays.jsx', editorOverlaysSource],
    ['PreviewStage.jsx', previewStageSource],
    ['Timeline.jsx', timelineSource],
    ['panels.jsx', panelsSource],
  ];
  const ANALYSERS: ReadonlyArray<readonly [string, string]> = [
    ['lib/media.js', mediaSource],
    ['lib/vision.js', visionSource],
    ['lib/personOutlineAnalysis.js', personOutlineSource],
    ['hooks/useDepthOfFieldAnalysis.js', depthOfFieldSource],
  ];

  it.each(RENDERERS)('%s renders no hardcoded crossOrigin attribute', (_name, source) => {
    expect(source).not.toContain('crossOrigin="anonymous"');
    expect(source).toContain('crossOrigin={mediaCrossOrigin(');
    expect(source).toContain('mediaCrossOrigin.js');
  });

  it.each(ANALYSERS)('%s sets crossOrigin through the helper, not directly', (_name, source) => {
    expect(source).not.toMatch(/\.crossOrigin\s*=\s*"anonymous"/);
    expect(source).toContain('applyMediaCrossOrigin(');
    expect(source).toContain('mediaCrossOrigin.js');
  });
});

import { describe, expect, it } from 'vitest';
import previewSource from '../../../vendor/ai-video-editor/src/components/PreviewStage.jsx?raw';

describe('upstream transition preview integration', () => {
  it('synchronizes the next video to its split source window instead of autoplaying from zero', () => {
    expect(previewSource).toContain('<TransitionPreviewVideo');
    expect(previewSource).not.toMatch(/previewTransition\.next\.src[^]*?autoPlay/);
    expect(previewSource).toContain('const segmentRef = useRef(segment);');
    expect(previewSource).toContain('shouldUseNativeVisualPlayback(segmentRef.current, isPlaying, true)');
    expect(previewSource).not.toContain('[isPlaying, segment, segment.id, segment.src]');
  });
});

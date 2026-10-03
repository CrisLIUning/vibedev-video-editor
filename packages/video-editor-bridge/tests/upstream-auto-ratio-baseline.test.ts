import { describe, expect, it } from 'vitest';

import { getAutoRatioBaselineKey, getAutoRatioSourceKey, getNearestRatioIdForSize } from '../../../vendor/ai-video-editor/src/lib/editorRuntime.js';
import lifecycleSource from '../../../vendor/ai-video-editor/src/hooks/useEditorLifecycle.js?raw';
import projectFilesSource from '../../../vendor/ai-video-editor/src/hooks/useProjectFiles.js?raw';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';

/**
 * Field report (2026-09-06, 剪二期): `project.set_ratio 2.39:1` landed as
 * revision 7; the console opened the cut, toasted "已根据素材自动切换为 16:9"
 * and autosaved revision 8 — the Agent's ratio gone before anyone saw it.
 *
 * The upstream effect that picks a ratio from the first sized clip runs on
 * every load, because its "have I seen this clip" ref starts empty. That is
 * the right behaviour when a person drops the first clip into an empty
 * project and the wrong one for a document that already carries a ratio
 * someone chose. The import now primes the ref with the document's own media,
 * so the effect reacts only to media added afterwards.
 */
describe('the auto-ratio baseline a loaded document sets', () => {
  it('keys on the identity of the first sized visual, never on its size', () => {
    // The size is measured after the media loads and is not in the saved
    // document; a key carrying it could never be primed from an import.
    expect(getAutoRatioSourceKey([])).toBe('');
    expect(getAutoRatioSourceKey([{ id: 'v1', width: 0, height: 0 }])).toBe('');
    expect(getAutoRatioSourceKey([{ id: 'v1' }, { id: 'v2', assetId: 'asset-2', width: 864, height: 496 }])).toBe('asset-2');
    expect(getAutoRatioSourceKey([{ id: 'v3', width: 1920, height: 1080 }])).toBe('v3');
    expect(getAutoRatioSourceKey(undefined)).toBe('');
  });

  it('primes from the first visual as saved, which is the clip the effect will see once measured', () => {
    const saved = [{ id: 'shot_a', assetId: 'canvas-file:canvas/uploads/seq.mp4', width: 0, height: 0 }, { id: 'shot_b', assetId: 'canvas-file:canvas/uploads/seq.mp4', width: 0, height: 0 }];
    const measured = saved.map((clip) => ({ ...clip, width: 864, height: 496 }));
    expect(getAutoRatioBaselineKey(saved)).toBe('canvas-file:canvas/uploads/seq.mp4');
    expect(getAutoRatioSourceKey(measured)).toBe(getAutoRatioBaselineKey(saved));
    expect(getAutoRatioBaselineKey([])).toBe('');
  });

  it('is what the import primes and what the effect compares against', () => {
    // The import writes the ref; the effect reads the same identity. If either
    // side drifts to its own formula, a loaded ratio is "corrected" again.
    expect(projectFilesSource).toContain('deps.autoRatioSourceKeyRef.current = getAutoRatioBaselineKey(data.visualSegments)');
    expect(lifecycleSource).toContain('const sourceKey = getAutoRatioSourceKey(d.visualSegments)');
    expect(appSource).toMatch(/useProjectFiles\(\{[\s\S]*?autoRatioSourceKeyRef[\s\S]*?\}\)/);
  });

  it('keeps the primed baseline while the loaded clips are still unmeasured', () => {
    // A cut saved before its first clip was measured loads with width 0. The
    // effect used to clear the baseline on that render, so the measurement a
    // moment later switched the ratio again (seen on undo in dsh-film).
    expect(lifecycleSource).toContain('if (!d.visualSegments.length) d.autoRatioSourceKeyRef.current = "";');
    expect(lifecycleSource).not.toMatch(/if \(!ratioSource\) \{\s*d\.autoRatioSourceKeyRef\.current = "";/);
  });

  it('still lets a clip pick the nearest frame, including the cinema ones', () => {
    expect(getNearestRatioIdForSize(864, 496)).toBe('16:9');
    expect(getNearestRatioIdForSize(2100, 900)).toBe('21:9');
    expect(getNearestRatioIdForSize(2048, 858)).toBe('2.39:1');
    expect(getNearestRatioIdForSize(1080, 1350)).toBe('4:5');
  });
});

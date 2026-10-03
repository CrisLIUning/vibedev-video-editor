// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaptionEditingActions, getCaptionPositionMode } from '../../../vendor/ai-video-editor/src/lib/captionEditingActions.js';
import { resolveCaptionSegmentPlacement } from '../../../vendor/ai-video-editor/src/lib/captionLayout.js';
import { buildNativeTimelineFfmpegPlan } from '../src/index.js';

type Caption = { id: string; text: string; start: number; end: number; placement?: string | { x: number; y: number }; fontId?: string; provenance?: object };
const initial: Caption[] = [
  { id: 'a', text: '第一句', start: 0, end: 3, fontId: 'default', provenance: { taskId: 'asr-one' } },
  { id: 'b', text: '第二句', start: 1, end: 4, placement: 'top' },
];
function harness(locks = {}) {
  let captions = structuredClone(initial);
  let placement = { x: 50, y: 78 };
  let mode = 'bottom';
  let selected = 'a';
  const frame = document.createElement('div');
  frame.getBoundingClientRect = () => ({ left: 100, top: 100, width: 1000, height: 500 }) as DOMRect;
  const notify = vi.fn();
  const actions = () => createCaptionEditingActions({
    captionSegments: captions, selectedCaptionSegment: captions.find(c => c.id === selected),
    captionPlacement: placement, captionPosition: mode, trackLocks: locks,
    previewCanvasRef: { current: frame }, notify,
    setCaptionSegments: (update: (items: Caption[]) => Caption[]) => { captions = update(captions); },
    setCaptionPlacement: (next: typeof placement) => { placement = next; },
    setCaptionPosition: (next: string) => { mode = next; },
    setSelectedSegmentId: (id: string) => { selected = id; }, setSelectedTrack: vi.fn(),
  });
  return { actions, notify, captions: () => captions, placement: () => placement, mode: () => mode, select: (id: string) => { selected = id; } };
}
afterEach(() => vi.restoreAllMocks());

describe('caption placement editing', () => {
  it('drags only the selected caption and reports custom without changing other defaults', () => {
    const h = harness();
    h.actions().startCaptionDrag({ button: 0, clientX: 400, clientY: 300, stopPropagation() {} }, 'a');
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 300 }));
    expect(h.captions()[0]?.placement).toEqual({ x: 30, y: 40 });
    expect(getCaptionPositionMode(h.captions()[0], h.mode())).toBe('custom');
    expect(h.captions()[1]).toEqual(initial[1]);
    expect(h.mode()).toBe('bottom');
    expect(h.placement()).toEqual({ x: 50, y: 78 });
  });

  it('switches a dragged caption back to a preset and custom preserves the effective preset coordinates', () => {
    const h = harness();
    h.actions().handleCaptionPositionChange('top');
    expect(h.captions()[0]?.placement).toBe('top');
    expect(resolveCaptionSegmentPlacement(h.captions()[0], h.placement())).toEqual({ x: 50, y: 18 });
    h.actions().handleCaptionPositionChange('custom');
    expect(h.captions()[0]?.placement).toEqual({ x: 50, y: 18 });
    h.actions().handleCaptionPositionChange('bottom');
    expect(getCaptionPositionMode(h.captions()[0], h.mode())).toBe('bottom');
    expect(resolveCaptionSegmentPlacement(h.captions()[0], h.placement())).toEqual({ x: 50, y: 78 });
  });

  it('applies only position to all captions, preserving timing, text, styles and ASR provenance', () => {
    const h = harness();
    h.actions().startCaptionDrag({ button: 0, clientX: 400, clientY: 300, stopPropagation() {} }, 'a');
    window.dispatchEvent(new MouseEvent('pointerup'));
    h.actions().applyCaptionPositionToAll();
    expect(h.captions()).toEqual(initial.map(caption => ({ ...caption, placement: { x: 30, y: 40 } })));
    expect(h.captions()[0]?.placement).not.toBe(h.captions()[1]?.placement);
    expect(h.placement()).toEqual({ x: 30, y: 40 });
    expect(h.mode()).toBe('custom');
    h.select('b'); h.actions().handleCaptionPositionChange('middle'); h.actions().applyCaptionPositionToAll();
    expect(h.captions().map(c => c.placement)).toEqual(['middle', 'middle']);
    expect(h.mode()).toBe('middle');
  });

  it('does not partially apply all when an overlapping caption lane is locked', () => {
    const h = harness({ 'caption-1': true });
    h.actions().handleCaptionPositionChange('middle');
    expect(h.captions()[0]?.placement).toBe('middle');
    const before = structuredClone(h.captions());
    h.actions().applyCaptionPositionToAll();
    expect(h.captions()).toEqual(before);
    h.select('b'); h.actions().handleCaptionPositionChange('bottom');
    h.actions().startCaptionDrag({ button: 0, stopPropagation() {} }, 'b');
    expect(h.captions()).toEqual(before);
    expect(h.notify).toHaveBeenCalledWith('captionPositionLocked');
  });

  it('uses the same named and custom coordinates for the preview and native export', () => {
    const captions = initial.map((c, i) => ({ ...c, placement: i ? 'top' : { x: 30, y: 40 } }));
    const result = buildNativeTimelineFfmpegPlan({
      project: { visualSegments: [{ id: 'v', type: 'video', duration: 4 }], captionsEnabled: true, captionSegments: captions },
      media: { visuals: [{ id: 'v', path: 'v.mp4' }] }, extractedFiles: new Map([['v.mp4', '/fixture/v.mp4']]),
      settings: { width: 1000, height: 500 },
    });
    for (const caption of captions) {
      const { x, y } = resolveCaptionSegmentPlacement(caption);
      expect(result.sidecars?.[0]?.content).toContain(`\\pos(${x * 10},${y * 5})`);
    }
  });
});

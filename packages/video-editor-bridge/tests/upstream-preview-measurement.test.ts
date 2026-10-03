// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { React, createRoot } from './upstream-react-harness.js';
import { usePreviewFrameSize } from '../../../vendor/ai-video-editor/src/hooks/usePreviewFrameSize.js';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('reattaches measurement when the preview DOM node is replaced', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const observed = new Set<Element>();
  vi.stubGlobal('ResizeObserver', class {
    node?: Element;
    observe(node: Element) { this.node = node; observed.add(node); }
    disconnect() { if (this.node) observed.delete(this.node); }
  });
  const first = document.createElement('div'), next = document.createElement('div');
  for (const [node, width] of [[first, 900], [next, 500]] as const) {
    document.body.append(node); Object.defineProperty(node, 'clientWidth', { value: width });
    Object.defineProperty(node, 'clientHeight', { value: 600 });
  }
  const ref = { current: first }; let size = { width: 0, height: 0 };
  function Harness({ node }: { node: HTMLDivElement }) {
    size = usePreviewFrameSize(ref, { width: 16, height: 9 }, false, node);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await React.act(() => root.render(React.createElement(Harness, { node: first })));
    expect(size.width).toBe(900);
    first.remove(); ref.current = next;
    await React.act(() => root.render(React.createElement(Harness, { node: next })));
    expect(size.width).toBe(500);
    expect(observed).toEqual(new Set([next]));
  } finally { await React.act(() => root.unmount()); }
});

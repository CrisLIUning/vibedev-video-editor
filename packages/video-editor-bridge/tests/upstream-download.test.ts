// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error vendored JavaScript is exercised directly before declaration generation
import { downloadBlob } from '../../../vendor/ai-video-editor/src/lib/media.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('embedded editor downloads', () => {
  it('clicks a document-connected anchor and keeps the object URL alive for desktop handoff', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:editor-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    let connectedDuringClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      connectedDuringClick = this.isConnected;
    });

    downloadBlob(new Blob(['video']), 'film.mp4');

    expect(connectedDuringClick).toBe(true);
    expect(document.querySelector('a[download="film.mp4"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:editor-export');
  });
});

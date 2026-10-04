import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETURN_REFRESH_MS, projectChangeOf, syncPage } from '../src/page-events.ts';
import type { PageSession } from '../src/page-events.ts';

const changed = (payload: unknown) => new MessageEvent('project-changed', { data: JSON.stringify(payload) });

function fakeSession(refresh: () => Promise<void> = async () => {}) {
  const session = {
    requestExternalRefresh: vi.fn(),
    refreshMaterial: vi.fn(refresh),
    setProject: vi.fn(),
  } satisfies PageSession;
  return session;
}

describe('projectChangeOf', () => {
  it('reads the title and aspect of this film\'s change', () => {
    expect(projectChangeOf(JSON.stringify({ type: 'project-changed', projectId: 'film-1', project: { id: 'film-1', title: '雨夜', aspectRatio: '9:16' } }), 'film-1'))
      .toEqual({ title: '雨夜', aspect: '9:16' });
    expect(projectChangeOf({ type: 'project-changed', projectId: 'film-1', project: { aspectRatio: '4:3' } }, 'film-1')).toEqual({ aspect: '4:3' });
  });

  it('ignores another film, an empty change and what is not JSON', () => {
    expect(projectChangeOf(JSON.stringify({ projectId: 'film-2', project: { id: 'film-2', title: '别的' } }), 'film-1')).toBeNull();
    expect(projectChangeOf(JSON.stringify({ projectId: 'film-1', project: { title: ' ' } }), 'film-1')).toBeNull();
    expect(projectChangeOf(JSON.stringify({ projectId: 'film-1' }), 'film-1')).toBeNull();
    expect(projectChangeOf('{', 'film-1')).toBeNull();
  });
});

describe('syncPage', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('refreshes the cut on file-changed and applies this film\'s project-changed', () => {
    const events = new EventTarget();
    const session = fakeSession();
    const stop = syncPage({ events, session, projectId: 'film-1' });
    events.dispatchEvent(new MessageEvent('file-changed', { data: '{}' }));
    expect(session.requestExternalRefresh).toHaveBeenCalledTimes(1);
    events.dispatchEvent(changed({ type: 'project-changed', projectId: 'film-1', project: { id: 'film-1', title: '雨夜（终版）', aspectRatio: '9:16' } }));
    events.dispatchEvent(changed({ type: 'project-changed', projectId: 'film-2', project: { id: 'film-2', title: '别的' } }));
    expect(session.setProject.mock.calls).toEqual([[{ title: '雨夜（终版）', aspect: '9:16' }]]);
    stop();
    events.dispatchEvent(new MessageEvent('file-changed', { data: '{}' }));
    expect(session.requestExternalRefresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads the material once when the page is shown and focused again', async () => {
    const session = fakeSession();
    const stop = syncPage({ events: new EventTarget(), session, projectId: 'film-1' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(RETURN_REFRESH_MS - 1);
    expect(session.refreshMaterial).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(session.refreshMaterial).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(RETURN_REFRESH_MS * 2);
    expect(session.refreshMaterial).toHaveBeenCalledTimes(1);
  });

  it('does not read while the page is hidden', async () => {
    const session = fakeSession();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const stop = syncPage({ events: new EventTarget(), session, projectId: 'film-1' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(RETURN_REFRESH_MS * 2);
      expect(session.refreshMaterial).not.toHaveBeenCalled();
    } finally {
      stop();
      hidden.mockRestore();
    }
  });

  it('reads once more after a read that a return interrupted, never two at once', async () => {
    let finish: (() => void) | undefined;
    const session = fakeSession(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = syncPage({ events: new EventTarget(), session, projectId: 'film-1' });
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(RETURN_REFRESH_MS);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(RETURN_REFRESH_MS * 2);
    expect(session.refreshMaterial).toHaveBeenCalledTimes(1);
    finish!();
    await vi.advanceTimersByTimeAsync(RETURN_REFRESH_MS);
    expect(session.refreshMaterial).toHaveBeenCalledTimes(2);
    finish!();
    stop();
  });
});

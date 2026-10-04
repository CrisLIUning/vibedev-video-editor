/**
 * What keeps the open editor in step with the film without the person asking:
 * the plugin's project events (`/api/projects/<id>/events`) and the page
 * coming back into view.
 *
 * - `file-changed` — an agent's edit, a generation landing: the cut and the
 *   material are read again.
 * - `project-changed` — the film was renamed or given another aspect: the
 *   editor shows the new title; the new aspect is for cuts not made yet, so
 *   it reaches only a cut with nothing on it, when the editor can draw it.
 * - the page shown again or focused — files the person put into the
 *   workspace from outside DSH raise no event, so the material is read again
 *   whenever they may have come back from doing that (debounced).
 */

import type { ProjectChange } from './session.ts';

/** What the page keeps in step. */
export interface PageSession {
  requestExternalRefresh(): void;
  refreshMaterial(): Promise<void>;
  setProject(change: ProjectChange): void;
}

/** How long the page waits after it is shown or focused before reading the material. */
export const RETURN_REFRESH_MS = 300;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * The title and aspect a `project-changed` event carries for this film, or
 * null when it is about another film or carries neither.
 * @param data - the event's data, as the stream sent it (JSON text).
 */
export function projectChangeOf(data: unknown, projectId: string): ProjectChange | null {
  let payload: unknown = data;
  if (typeof data === 'string') {
    try {
      payload = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (payload === null || typeof payload !== 'object') return null;
  const { projectId: eventProject, project } = payload as { projectId?: unknown; project?: unknown };
  if (project === null || typeof project !== 'object') return null;
  const { id, title, aspectRatio } = project as { id?: unknown; title?: unknown; aspectRatio?: unknown };
  if (eventProject !== projectId && id !== projectId) return null;
  const change: ProjectChange = {};
  const nextTitle = text(title);
  const nextAspect = text(aspectRatio);
  if (nextTitle !== undefined) change.title = nextTitle;
  if (nextAspect !== undefined) change.aspect = nextAspect;
  return nextTitle === undefined && nextAspect === undefined ? null : change;
}

export interface PageSyncOptions {
  /** The project event stream (an `EventSource`). */
  events: EventTarget;
  session: PageSession;
  projectId: string;
  /** The page's window; its document's visibility counts too. */
  view?: Window;
  returnDelayMs?: number;
}

/**
 * Keep the editor in step with the film's events and with the page coming
 * back into view.
 * @returns stops listening.
 */
export function syncPage(options: PageSyncOptions): () => void {
  const { events, session, projectId } = options;
  const view = options.view ?? window;
  const delay = options.returnDelayMs ?? RETURN_REFRESH_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let again = false;

  const read = (): void => {
    timer = undefined;
    if (stopped) return;
    // One read at a time; a return during a read asks for one more after it.
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    void session.refreshMaterial().catch(() => undefined).finally(() => {
      reading = false;
      if (again) {
        again = false;
        schedule();
      }
    });
  };
  const schedule = (): void => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(read, delay);
  };

  const onFileChanged = (): void => { session.requestExternalRefresh(); };
  const onProjectChanged = (event: Event): void => {
    const change = projectChangeOf((event as MessageEvent).data, projectId);
    if (change !== null) session.setProject(change);
  };
  const onVisibility = (): void => { if (view.document.visibilityState === 'visible') schedule(); };
  const onFocus = (): void => { schedule(); };

  events.addEventListener('file-changed', onFileChanged);
  events.addEventListener('project-changed', onProjectChanged);
  view.document.addEventListener('visibilitychange', onVisibility);
  view.addEventListener('focus', onFocus);

  return () => {
    stopped = true;
    clearTimeout(timer);
    events.removeEventListener('file-changed', onFileChanged);
    events.removeEventListener('project-changed', onProjectChanged);
    view.document.removeEventListener('visibilitychange', onVisibility);
    view.removeEventListener('focus', onFocus);
  };
}

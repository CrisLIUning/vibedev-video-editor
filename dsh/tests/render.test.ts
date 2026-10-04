import { describe, expect, it, vi } from 'vitest';

import type { MountedVideoEditor, VideoEditorDocumentEnvelope } from '../../packages/video-editor-bridge/src/host-contract.ts';
import { HostRequestError, TimelineConflictError } from '../src/api.ts';
import type { RenderedFile, TaskSnapshot, TimelineState } from '../src/api.ts';
import { describeRefusal } from '../src/refusals.ts';
import { TimelineSession, percentOf, renderRequestOf } from '../src/session.ts';
import type { SessionApi } from '../src/session.ts';

const archive = (caption: string) => ({ format: 'timeline-studio-archive', version: 3, project: { captionSegments: [{ id: 'c1', text: caption }] } });
const state = (revision: number, document: unknown): TimelineState => ({ document, revision, canUndo: false, canRedo: false, historyLength: revision });

const rendered: RenderedFile = {
  name: 'canvas/renders/雨夜.mp4', size: 10, kind: 'video', mime: 'video/mp4', durationSeconds: 10, width: 1920, height: 1080, frameRate: 30, hasAudio: true, sha256: 'a'.repeat(64), landedNodeId: 'video-1',
};
const snapshot = (status: TaskSnapshot['status'], progress: string[], extra: Partial<TaskSnapshot<RenderedFile>> = {}): TaskSnapshot<RenderedFile> =>
  ({ taskId: 'timeline_1', status, startedAt: 0, endedAt: null, progress, nextSince: progress.length, ...extra });

/** The plugin's cut and render calls; each wait answers the next snapshot. */
function fakeApi(snapshots: Array<TaskSnapshot<RenderedFile>> = [], overrides: Partial<SessionApi> = {}) {
  let stored = state(0, null);
  const saves: unknown[] = [];
  const bodies: unknown[] = [];
  const waits: Array<{ taskId: string; since: number }> = [];
  const api: SessionApi = {
    getTimeline: async () => stored,
    saveTimeline: async (document, baseRevision) => {
      saves.push(document);
      if (baseRevision !== stored.revision) throw new TimelineConflictError(stored);
      stored = state(stored.revision + 1, document);
      return stored;
    },
    undoTimeline: async () => stored,
    redoTimeline: async () => stored,
    getMaterial: async () => ({ assets: [], projectFiles: [] }),
    uploadFile: async (path, blob) => ({ name: path, size: blob.size, mime: blob.type }),
    renderTimeline: async (body) => { bodies.push(body); return { taskId: 'timeline_1' }; },
    waitTask: async (taskId, since) => { waits.push({ taskId, since }); return snapshots.shift() ?? snapshot('failed', [], { error: { message: 'gone' } }); },
    ...overrides,
  };
  return { api, saves, bodies, waits };
}

function fakeEditor() {
  const documents: VideoEditorDocumentEnvelope[] = [];
  const editor = {
    updateDocument: (document: VideoEditorDocumentEnvelope) => { documents.push(document); },
    resolveCommand: () => {},
    unmount: () => {},
    flushChanges: async () => {},
    whenIdle: async () => {},
  } satisfies MountedVideoEditor;
  return { editor, documents };
}

const open = (api: SessionApi, extra: { notify?: (message: string, tone: 'info' | 'success' | 'error') => void; obtainRenderer?: (modelId: string) => Promise<void> } = {}) =>
  new TimelineSession({ api, boardId: 'film-1', projectId: 'film-1', title: '雨夜', ...extra });

const settings = { fileName: ' 雨夜 ', resolution: '1080', frameRate: 30 };

describe('rendering into the project', () => {
  it('saves first, renders that revision, toasts each quarter once and says where the file went', async () => {
    const { api, bodies, waits, saves } = fakeApi([
      snapshot('running', ['准备渲染']),
      snapshot('running', ['render 30% · 3.0s / 10.0s']),
      snapshot('running', ['render 31% · 3.1s / 10.0s']),
      snapshot('running', ['render 80% · 8.0s / 10.0s']),
      snapshot('done', [], { file: rendered }),
    ]);
    const notify = vi.fn();
    const session = open(api, { notify });
    await session.load();
    session.attach(fakeEditor().editor);
    session.handleEvent({ type: 'dirty', baseRevision: 0 });
    session.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('一') });
    await session.startRender(settings);
    expect(saves).toHaveLength(1);
    expect(bodies).toEqual([{ frameRate: 30, resolution: '1080', fileName: '雨夜', baseRevision: 1 }]);
    expect(waits.map(wait => wait.since)).toEqual([0, 1, 1, 1, 1]);
    expect(notify.mock.calls).toEqual([
      ['正在提交渲染…', 'info'],
      ['渲染中 30%', 'info'],
      ['渲染中 80%', 'info'],
      ['已存入 film/canvas/renders/雨夜.mp4，并放到了分镜画布上', 'success'],
    ]);
  });

  it('starts from the editor\'s render request, and leaves the board out of the message when nothing landed', async () => {
    const { api } = fakeApi([snapshot('done', [], { file: { ...rendered, landedNodeId: null } })]);
    const notify = vi.fn();
    const session = open(api, { notify });
    await session.load();
    session.handleEvent({ type: 'render-request', baseRevision: 0, settings });
    await vi.waitFor(() => expect(notify).toHaveBeenLastCalledWith('已存入 film/canvas/renders/雨夜.mp4', 'success'));
  });

  it('refuses a second render from the same page while one is followed', async () => {
    let finish!: (value: TaskSnapshot<RenderedFile>) => void;
    const { api } = fakeApi([], { waitTask: () => new Promise(resolve => { finish = resolve; }) });
    const notify = vi.fn();
    const session = open(api, { notify });
    await session.load();
    const first = session.startRender(settings);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await session.startRender(settings);
    expect(notify).toHaveBeenLastCalledWith('已经在渲染了，等这一次完成', 'info');
    finish(snapshot('done', [], { file: rendered }));
    await first;
  });

  it('shows the cut that moved on instead of rendering it unseen', async () => {
    const { api } = fakeApi([], { renderTimeline: async () => { throw new TimelineConflictError(state(6, archive('别处的'))); } });
    const notify = vi.fn();
    const session = open(api, { notify });
    const { editor, documents } = fakeEditor();
    await session.load();
    session.attach(editor);
    await session.startRender(settings);
    expect(session.revision).toBe(6);
    expect(documents.at(-1)?.upstreamDocument).toEqual(archive('别处的'));
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/^渲染失败：剪辑刚被别处改过/), 'error');
  });

  it('offers the renderer download once when there is no ffmpeg, then renders', async () => {
    let attempt = 0;
    const missing = new HostRequestError('no ffmpeg', 503, 'FFMPEG_UNAVAILABLE', { detail: { downloadable: true, modelId: 'ffmpeg-win64-gpl-shared-9.0', totalBytes: 86_333_540 } });
    const first = fakeApi([snapshot('done', [], { file: rendered })], {
      renderTimeline: async () => {
        attempt += 1;
        if (attempt === 1) throw missing;
        return { taskId: 'timeline_1' };
      },
    });
    const obtainRenderer = vi.fn(async () => {});
    const notify = vi.fn();
    const session = open(first.api, { notify, obtainRenderer });
    await session.load();
    await session.startRender(settings);
    expect(obtainRenderer).toHaveBeenCalledWith('ffmpeg-win64-gpl-shared-9.0');
    expect(attempt).toBe(2);
    expect(notify).toHaveBeenLastCalledWith('已存入 film/canvas/renders/雨夜.mp4，并放到了分镜画布上', 'success');

    // A download that does not help is not offered twice.
    const stubborn = fakeApi([], { renderTimeline: async () => { throw missing; } });
    const again = vi.fn(async () => {});
    const told = vi.fn();
    const second = open(stubborn.api, { notify: told, obtainRenderer: again });
    await second.load();
    await second.startRender(settings);
    expect(again).toHaveBeenCalledTimes(1);
    expect(told).toHaveBeenLastCalledWith(expect.stringContaining('ffmpegPath'), 'error');

    // Declined: nothing renders, and that is not reported as a failure.
    const declined = fakeApi([], { renderTimeline: async () => { throw missing; } });
    const quiet = vi.fn();
    const third = open(declined.api, { notify: quiet, obtainRenderer: async () => { throw new DOMException('没有下载', 'AbortError'); } });
    await third.load();
    await third.startRender(settings);
    expect(quiet).toHaveBeenLastCalledWith('没有下载渲染程序，这次没有渲染', 'info');
  });

  it('follows a render already running instead of starting another', async () => {
    const { api, waits } = fakeApi([snapshot('done', [], { file: rendered })], {
      renderTimeline: async () => { throw new HostRequestError('busy', 409, 'RENDER_BUSY', { taskId: 'timeline_0' }); },
    });
    const notify = vi.fn();
    const session = open(api, { notify });
    await session.load();
    await session.startRender(settings);
    expect(waits[0]!.taskId).toBe('timeline_0');
    expect(notify).toHaveBeenCalledWith('已经有一次渲染在进行，接着报告它的进度', 'info');
  });

  it('reports a failed or cancelled render by its code, in Chinese', async () => {
    const failed = fakeApi([snapshot('failed', ['render 40% · 4.0s / 10.0s'], { error: { code: 'FFMPEG_FAILED', message: 'ffmpeg exited with code 1: Invalid data found' } })]);
    const notify = vi.fn();
    const session = open(failed.api, { notify });
    await session.load();
    await session.startRender(settings);
    expect(notify).toHaveBeenLastCalledWith('渲染失败：ffmpeg 报错退出：Invalid data found', 'error');

    const cancelled = fakeApi([snapshot('interrupted', [], { error: { code: 'RENDER_CANCELED', message: 'render canceled' } })]);
    const told = vi.fn();
    const other = open(cancelled.api, { notify: told });
    await other.load();
    await other.startRender(settings);
    expect(told).toHaveBeenLastCalledWith('渲染失败：渲染已取消', 'error');
  });

  it('checks the saved cut when the export panel opens', async () => {
    const checks: unknown[] = [];
    const ok = fakeApi([], { checkRender: async (body) => { checks.push(body); return { ok: true, width: 1280, height: 720, frameRate: 30, durationSeconds: 3, hasAudio: false, outputPath: 'canvas/renders/a.mp4' }; } });
    const session = open(ok.api);
    await session.load();
    expect(await session.checkRender({ resolution: '720', frameRate: 30 })).toEqual({ ok: true, reasons: [] });
    expect(checks).toEqual([{ frameRate: 30, resolution: '720', baseRevision: 0 }]);

    const empty = fakeApi([], { checkRender: async () => { throw new HostRequestError('EMPTY_TIMELINE: no visual clip', 422, 'EMPTY_TIMELINE'); } });
    expect(await open(empty.api).checkRender({ resolution: '720', frameRate: 30 })).toEqual({ ok: false, reasons: ['时间线上还没有画面，先放一段素材再渲染'] });

    // A renderer the plugin can download is offered on pressing, not marked as a refusal.
    const download = fakeApi([], { checkRender: async () => { throw new HostRequestError('no ffmpeg', 503, 'FFMPEG_UNAVAILABLE', { detail: { downloadable: true, modelId: 'ffmpeg-win64-gpl-shared-9.0' } }); } });
    expect(await open(download.api, { obtainRenderer: async () => {} }).checkRender({ resolution: '720', frameRate: 30 })).toEqual({ ok: true, reasons: [] });
  });

  it('reads the panel\'s settings and the render\'s progress lines', () => {
    expect(renderRequestOf({ resolution: '4k', frameRate: 25 })).toEqual({ frameRate: 30, resolution: '720' });
    expect(renderRequestOf({ resolution: '2160', frameRate: 60, fileName: '  ' })).toEqual({ frameRate: 60, resolution: '2160' });
    expect(percentOf(['准备渲染', 'render 12% · 1.2s / 10.0s', '其他'], 0)).toBe(12);
    expect(percentOf([], 7)).toBe(7);
  });
});

describe('refusals in Chinese', () => {
  it('keeps the specifics after the code\'s own wording, and passes unknown codes through', () => {
    expect(describeRefusal({ code: 'MISSING_MEDIA', message: 'clips are not project files: visual/v1 (a.mp4)' })).toBe('这些片段的文件不在项目里，渲不了：visual/v1 (a.mp4)');
    expect(describeRefusal({ code: 'UNSUPPORTED_RENDER_FEATURE', message: 'cannot render: transitions, overlay masks, sparkles' })).toBe('本机渲染还不支持：这种转场、叠加层遮罩、sparkles');
    expect(describeRefusal({ code: 'FFMPEG_MISSING_FILTER', message: 'ffmpeg lacks the subtitles filter (libass)' })).toContain('没带 libass');
    expect(describeRefusal({ code: 'FFMPEG_MISSING_FILTER', message: 'missing filter: xfade' })).toBe('本机的 ffmpeg 缺少渲染要用的滤镜：xfade');
    expect(describeRefusal({ code: 'CAPTION_CLIP_NOT_FOUND', message: 'CAPTION_CLIP_NOT_FOUND: clip-9' })).toBe('时间线上找不到要识别的片段：clip-9');
    expect(describeRefusal({ code: 'SOMETHING_NEW', message: 'the plugin says why' })).toBe('the plugin says why');
    expect(describeRefusal(new Error('plain'))).toBe('plain');
  });
});

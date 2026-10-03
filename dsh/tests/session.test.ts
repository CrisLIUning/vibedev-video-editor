import { describe, expect, it, vi } from 'vitest';

import type { MountedVideoEditor, VideoEditorDocumentEnvelope } from '../../packages/video-editor-bridge/src/host-contract.ts';
import { TimelineConflictError } from '../src/api.ts';
import type { TimelineState, UploadedFile } from '../src/api.ts';
import { TimelineSession, splitExportName } from '../src/session.ts';
import type { SessionApi } from '../src/session.ts';

const archive = (caption: string) => ({
  format: 'timeline-studio-archive',
  version: 3,
  project: { captionSegments: [{ id: 'c1', text: caption }] },
});

const state = (revision: number, document: unknown): TimelineState => ({ document, revision, canUndo: revision > 1, canRedo: false, historyLength: revision });

function fakeApi(overrides: Partial<SessionApi> = {}) {
  const saves: Array<{ document: unknown; baseRevision: number }> = [];
  let stored = state(0, null);
  const api: SessionApi = {
    getTimeline: async () => stored,
    saveTimeline: async (document, baseRevision) => {
      saves.push({ document, baseRevision });
      if (baseRevision !== stored.revision) throw new TimelineConflictError(stored);
      stored = state(stored.revision + 1, document);
      return stored;
    },
    undoTimeline: async () => { stored = state(stored.revision + 1, archive('撤销后')); return stored; },
    redoTimeline: async () => stored,
    getMaterial: async () => ({ assets: [{ assetId: 'canvas-file:a.png', versionId: 'canvas-file:a.png', kind: 'image', name: 'a.png', url: '/api/projects/film-1/raw/a.png', mimeType: 'image/png' }], projectFiles: [] }),
    uploadFile: async (path, blob) => ({ name: path, size: blob.size, mime: blob.type }) satisfies UploadedFile,
    ...overrides,
  };
  return { api, saves, setStored: (next: TimelineState) => { stored = next; } };
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

const session = (api: SessionApi, onSaveError = vi.fn()) =>
  new TimelineSession({ api, boardId: 'film-1', projectId: 'film-1', title: '雨夜', aspect: '9:16', onSaveError });

describe('the editor document', () => {
  it('opens an uncut film on an empty archive in the film\'s aspect, with its material', async () => {
    const { api } = fakeApi();
    const open = session(api);
    await open.load();
    const envelope = open.envelope();
    expect(envelope).toMatchObject({ schemaVersion: 1, projectId: 'film-1', productionId: 'film-1', compositeId: 'film-1', projectTitle: '雨夜', projectAspect: '9:16', revision: 0, documentVersionId: 'canvas:film-1:0' });
    expect(envelope.upstreamDocument).toMatchObject({ format: 'timeline-studio-archive', version: 3, project: { ratioId: '9:16' } });
    expect(envelope.assets).toHaveLength(1);
  });

  it('leaves an aspect the editor cannot draw to the editor', () => {
    const { api } = fakeApi();
    const open = new TimelineSession({ api, boardId: 'b', projectId: 'b', title: 't', aspect: '4:3' });
    expect(open.envelope().projectAspect).toBeUndefined();
  });
});

describe('saving', () => {
  it('saves each edit on the revision it was built on and hands the editor the result', async () => {
    const { api, saves } = fakeApi();
    const open = session(api);
    const { editor, documents } = fakeEditor();
    await open.load();
    open.attach(editor);
    open.handleEvent({ type: 'dirty', baseRevision: 0 });
    open.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('一') });
    await open.drainSaves();
    expect(saves).toEqual([{ document: archive('一'), baseRevision: 0 }]);
    expect(open.revision).toBe(1);
    expect(documents.at(-1)?.revision).toBe(1);
    expect(open.busy).toBe(false);
  });

  it('adopts the current cut when a save was overtaken, instead of writing over it', async () => {
    const { api, saves, setStored } = fakeApi();
    const onSaveError = vi.fn();
    const open = session(api, onSaveError);
    const { editor, documents } = fakeEditor();
    await open.load();
    open.attach(editor);
    setStored(state(4, archive('别处的改动')));
    open.handleEvent({ type: 'dirty', baseRevision: 0 });
    open.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('我的改动') });
    await open.drainSaves();
    expect(saves).toHaveLength(1);
    expect(open.revision).toBe(4);
    expect(documents.at(-1)?.upstreamDocument).toEqual(archive('别处的改动'));
    expect(onSaveError).toHaveBeenLastCalledWith(null);
    expect(open.busy).toBe(false);
  });

  it('keeps the draft and says so when a save fails', async () => {
    const { api } = fakeApi({ saveTimeline: async () => { throw new Error('磁盘满了'); } });
    const onSaveError = vi.fn();
    const open = session(api, onSaveError);
    await open.load();
    open.attach(fakeEditor().editor);
    open.handleEvent({ type: 'dirty', baseRevision: 0 });
    open.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('一') });
    await expect(open.drainSaves()).rejects.toThrow('磁盘满了');
    expect(onSaveError).toHaveBeenLastCalledWith('保存失败：磁盘满了');
    expect(open.busy).toBe(true);
    await expect(open.prepareTimeline()).rejects.toThrow('磁盘满了');
  });

  it('saves pending edits before stepping back, then imports the step', async () => {
    const { api, saves } = fakeApi();
    const open = session(api);
    const { editor, documents } = fakeEditor();
    await open.load();
    open.attach(editor);
    open.handleEvent({ type: 'dirty', baseRevision: 0 });
    open.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('一') });
    await open.handleEvent({ type: 'history-request', direction: 'undo', baseRevision: 0 });
    expect(saves).toHaveLength(1);
    expect(open.revision).toBe(2);
    expect(documents.at(-1)?.upstreamDocument).toEqual(archive('撤销后'));
  });
});

describe('outside changes', () => {
  it('adopts a newer cut from disk when nothing is being edited', async () => {
    vi.useFakeTimers();
    try {
      const { api, setStored } = fakeApi();
      const open = session(api);
      const { editor, documents } = fakeEditor();
      await open.load();
      open.attach(editor);
      setStored(state(3, archive('智能体改的')));
      open.requestExternalRefresh();
      await vi.advanceTimersByTimeAsync(200);
      expect(open.revision).toBe(3);
      expect(documents.at(-1)?.upstreamDocument).toEqual(archive('智能体改的'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits while an edit is unsaved', async () => {
    vi.useFakeTimers();
    try {
      const { api, setStored } = fakeApi();
      const open = session(api);
      await open.load();
      open.attach(fakeEditor().editor);
      open.handleEvent({ type: 'dirty', baseRevision: 0 });
      setStored(state(3, archive('智能体改的')));
      open.requestExternalRefresh();
      await vi.advanceTimersByTimeAsync(200);
      expect(open.revision).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('keeping an export', () => {
  it('names the video freely and puts its captions beside it under the same stem', async () => {
    const uploads: Array<{ path: string; unique: boolean | undefined }> = [];
    const { api } = fakeApi({
      uploadFile: async (path, blob, options) => {
        uploads.push({ path, unique: options.unique });
        return { name: options.unique ? path.replace('.mp4', '-2.mp4') : path, size: blob.size, mime: blob.type };
      },
    });
    const open = session(api);
    const notify = vi.fn();
    const kept = await open.keepExport([
      { blob: new Blob(['v'], { type: 'video/mp4' }), name: '雨夜 成片.mp4', kind: 'video' },
      { blob: new Blob(['s'], { type: 'text/plain' }), name: '雨夜 成片.srt', kind: 'captions' },
    ], notify);
    expect(kept).toBe(true);
    expect(uploads).toEqual([
      { path: 'canvas/renders/雨夜 成片.mp4', unique: true },
      { path: 'canvas/renders/雨夜 成片-2.srt', unique: undefined },
    ]);
    expect(notify).toHaveBeenCalledWith('已保存到 film/canvas/renders/雨夜 成片-2.mp4', 'success');
  });

  it('hands the files back to the editor\'s download when they cannot be kept', async () => {
    const { api } = fakeApi({ uploadFile: async () => { throw new Error('太大了'); } });
    const notify = vi.fn();
    expect(await session(api).keepExport([{ blob: new Blob(['v']), name: 'cut.mp4', kind: 'video' }], notify)).toBe(false);
    expect(notify).toHaveBeenCalledWith('保存到项目失败，改为下载：太大了', 'error');
  });

  it('splits a download name into a safe stem and an extension', () => {
    expect(splitExportName('a/b:c.MP4')).toEqual({ base: 'a-b-c', extension: 'mp4' });
    expect(splitExportName('noext')).toEqual({ base: 'noext', extension: 'bin' });
  });
});

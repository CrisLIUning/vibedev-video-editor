import { describe, expect, it, vi } from 'vitest';

import type { MountedVideoEditor, VideoEditorAuthorizedAsset, VideoEditorDocumentEnvelope, VideoEditorProjectFile } from '../../packages/video-editor-bridge/src/host-contract.ts';
import type { Material, TimelineState, UploadedFile } from '../src/api.ts';
import { TRUNCATED_MATERIAL_NOTICE, TimelineSession, visibleProjectFiles } from '../src/session.ts';
import type { ImportRecord, SessionApi } from '../src/session.ts';

const state = (revision: number, document: unknown): TimelineState => ({ document, revision, canUndo: false, canRedo: false, historyLength: revision });
const archive = (caption: string) => ({ format: 'timeline-studio-archive', version: 3, project: { captionSegments: [{ id: 'c1', text: caption }] } });

const filmAsset = (path: string): VideoEditorAuthorizedAsset => ({
  assetId: `canvas-file:${path}`, versionId: `canvas-file:${path}`, kind: 'video', name: path.split('/').pop()!,
  url: `/api/projects/film-1/raw/${path}`, mimeType: 'video/mp4', sizeBytes: 3,
});
const workspaceFile = (path: string, extra: Partial<VideoEditorProjectFile> = {}): VideoEditorProjectFile => ({
  id: `workspace:${path}`, path, name: path.split('/').pop()!, kind: 'video',
  url: `/api/dsh-film/media?cwd=C%3A%5Cws&path=${encodeURIComponent(path)}`, mimeType: 'video/mp4', sizeBytes: 3, mtime: 1000, ...extra,
});

function fakeApi(listing: () => Material, overrides: Partial<SessionApi> = {}) {
  let stored = state(0, null);
  const imports: string[] = [];
  const api: SessionApi = {
    getTimeline: async () => stored,
    saveTimeline: async (document) => { stored = state(stored.revision + 1, document); return stored; },
    undoTimeline: async () => stored,
    redoTimeline: async () => stored,
    getMaterial: async () => listing(),
    importWorkspaceFile: async (path) => { imports.push(path); return { name: `canvas/media/${path.split('/').pop()}`, size: 3, mime: 'video/mp4' } satisfies UploadedFile; },
    uploadFile: async (path, blob) => ({ name: path, size: blob.size, mime: blob.type }),
    ...overrides,
  };
  return { api, imports };
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

const open = (api: SessionApi, extra: { notify?: (message: string, tone: 'info' | 'success' | 'error') => void } = {}) =>
  new TimelineSession({ api, boardId: 'film-1', projectId: 'film-1', title: '雨夜', aspect: '16:9', ...extra });

describe('visibleProjectFiles', () => {
  const imported = new Map<string, ImportRecord>([['shots/第一场/take.mp4', { filmPath: 'canvas/media/take.mp4', sizeBytes: 3, mtime: 1000 }]]);

  it('never offers a file inside film/: it is one of the film\'s own assets', () => {
    expect(visibleProjectFiles([], [workspaceFile('film/canvas/media/a.mp4'), workspaceFile('filmstrip/a.mp4')], new Map()).map(file => file.path))
      .toEqual(['filmstrip/a.mp4']);
  });

  it('leaves out a file this page imported while its copy is in the film and it has not changed', () => {
    const files = [workspaceFile('shots/第一场/take.mp4'), workspaceFile('shots/other.mp4')];
    expect(visibleProjectFiles([filmAsset('canvas/media/take.mp4')], files, imported).map(file => file.path)).toEqual(['shots/other.mp4']);
  });

  it('offers it again once it changed, or when the film no longer has the copy', () => {
    expect(visibleProjectFiles([filmAsset('canvas/media/take.mp4')], [workspaceFile('shots/第一场/take.mp4', { mtime: 2000 })], imported)).toHaveLength(1);
    expect(visibleProjectFiles([filmAsset('canvas/media/take.mp4')], [workspaceFile('shots/第一场/take.mp4', { sizeBytes: 9 })], imported)).toHaveLength(1);
    expect(visibleProjectFiles([], [workspaceFile('shots/第一场/take.mp4')], imported)).toHaveLength(1);
  });
});

describe('the material in the library', () => {
  it('stops offering an imported workspace file beside its film copy, even when a listing still offers it', async () => {
    let material: Material = { assets: [], projectFiles: [workspaceFile('shots/第一场/take.mp4')] };
    const { api, imports } = fakeApi(() => material);
    const session = open(api);
    const { editor, documents } = fakeEditor();
    await session.load();
    session.attach(editor);
    const file = await session.importWorkspaceFile('shots/第一场/take.mp4');
    expect(imports).toEqual(['shots/第一场/take.mp4']);
    expect(file.name).toBe('canvas/media/take.mp4');
    // A listing the plugin read before it noticed the import.
    material = { assets: [filmAsset('canvas/media/take.mp4')], projectFiles: [workspaceFile('shots/第一场/take.mp4')] };
    await session.refreshMaterial();
    expect(documents.at(-1)?.assets.map(asset => asset.assetId)).toEqual(['canvas-file:canvas/media/take.mp4']);
    expect(documents.at(-1)?.projectFiles ?? []).toEqual([]);
  });

  it('does not hand the editor a listing that did not change', async () => {
    const material: Material = { assets: [filmAsset('canvas/media/a.mp4')], projectFiles: [workspaceFile('b.mp4')] };
    const { api } = fakeApi(() => structuredClone(material));
    const session = open(api);
    const { editor, documents } = fakeEditor();
    await session.load();
    session.attach(editor);
    await session.refreshMaterial();
    expect(documents).toHaveLength(0);
    material.projectFiles.push(workspaceFile('c.mp4'));
    await session.refreshMaterial();
    expect(documents).toHaveLength(1);
    expect(documents[0]?.projectFiles?.map(file => file.path)).toEqual(['b.mp4', 'c.mp4']);
  });

  it('waits for a save in flight before showing new material, so the cut as last saved is not imported over the edit', async () => {
    vi.useFakeTimers();
    try {
      let material: Material = { assets: [], projectFiles: [] };
      let finishSave: (() => void) | undefined;
      let stored = state(0, null);
      const { api } = fakeApi(() => material, {
        getTimeline: async () => stored,
        saveTimeline: (document) => new Promise((resolve) => {
          finishSave = () => { stored = state(1, document); resolve(stored); };
        }),
      });
      const session = open(api);
      const { editor, documents } = fakeEditor();
      await session.load();
      session.attach(editor);
      session.handleEvent({ type: 'dirty', baseRevision: 0 });
      session.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('我的改动') });
      material = { assets: [filmAsset('canvas/media/new.mp4')], projectFiles: [] };
      await session.refreshMaterial();
      expect(documents).toHaveLength(0);
      finishSave!();
      await session.drainSaves();
      await vi.advanceTimersByTimeAsync(200);
      expect(documents.length).toBeGreaterThan(0);
      for (const document of documents) expect(document.upstreamDocument).toEqual(archive('我的改动'));
      expect(documents.at(-1)?.assets.map(asset => asset.assetId)).toEqual(['canvas-file:canvas/media/new.mp4']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says once, after the editor is ready, that the workspace has more media than the library lists', async () => {
    let material: Material = { assets: [], projectFiles: [workspaceFile('a.mp4')], truncated: true };
    const { api } = fakeApi(() => material);
    const notify = vi.fn();
    const session = open(api, { notify });
    await session.load();
    expect(session.materialTruncated).toBe(true);
    // The editor's first 'ready' comes while it is being mounted: too early for its toast.
    session.handleEvent({ type: 'ready', revision: 0 });
    expect(notify).not.toHaveBeenCalled();
    session.attach(fakeEditor().editor);
    session.handleEvent({ type: 'ready', revision: 0 });
    session.handleEvent({ type: 'ready', revision: 0 });
    await session.refreshMaterial();
    expect(notify.mock.calls).toEqual([[TRUNCATED_MATERIAL_NOTICE, 'info']]);
    material = { ...material, truncated: false };
    await session.refreshMaterial();
    expect(session.materialTruncated).toBe(false);
    material = { ...material, truncated: true };
    await session.refreshMaterial();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('the film changing', () => {
  it('shows a renamed film and its new aspect in the open editor', async () => {
    const { api } = fakeApi(() => ({ assets: [], projectFiles: [] }));
    const session = open(api);
    const { editor, documents } = fakeEditor();
    await session.load();
    session.attach(editor);
    session.setProject({ title: '雨夜（终版）', aspect: '9:16' });
    expect(documents.at(-1)).toMatchObject({ projectTitle: '雨夜（终版）', projectAspect: '9:16' });
    session.setProject({ title: '雨夜（终版）' });
    expect(documents).toHaveLength(1);
    // A stored aspect the editor cannot draw leaves the editor's ratio alone.
    session.setProject({ aspect: '4:3' });
    expect(documents.at(-1)?.projectTitle).toBe('雨夜（终版）');
    expect(documents.at(-1)?.projectAspect).toBeUndefined();
  });

  it('waits while an edit is being saved', async () => {
    vi.useFakeTimers();
    try {
      let finishSave: (() => void) | undefined;
      let stored = state(0, null);
      const { api } = fakeApi(() => ({ assets: [], projectFiles: [] }), {
        getTimeline: async () => stored,
        saveTimeline: (document) => new Promise((resolve) => {
          finishSave = () => { stored = state(1, document); resolve(stored); };
        }),
      });
      const session = open(api);
      const { editor, documents } = fakeEditor();
      await session.load();
      session.attach(editor);
      session.handleEvent({ type: 'dirty', baseRevision: 0 });
      session.handleEvent({ type: 'save-request', baseRevision: 0, upstreamDocument: archive('我的改动') });
      session.setProject({ title: '新片名' });
      await vi.advanceTimersByTimeAsync(0);
      expect(documents).toHaveLength(0);
      finishSave!();
      await session.drainSaves();
      await vi.advanceTimersByTimeAsync(200);
      expect(documents.at(-1)).toMatchObject({ projectTitle: '新片名', upstreamDocument: archive('我的改动') });
    } finally {
      vi.useRealTimers();
    }
  });
});

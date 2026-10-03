// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  createEditorHostBridge,
  type VideoEditorDocumentEnvelope,
  type VideoEditorHostEvent,
} from '../src/index.js';

function documentEnvelope(revision = 0): VideoEditorDocumentEnvelope {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    productionId: 'production-1',
    projectTitle: 'VibeDev Promo',
    compositeId: 'composite-1',
    revision,
    documentVersionId: `version-${revision}`,
    upstreamDocument: {
      format: 'timeline-studio-archive',
      version: 3,
      project: { visualSegments: [{ id: 'visual-1', src: '/media/one.mp4' }] },
      media: { visuals: [] },
    },
    assets: [],
  };
}

describe('editor host project synchronization', () => {
  it('queues redo until undo has delivered and imported its document', async () => {
    const envelope = documentEnvelope(7);
    const events: VideoEditorHostEvent[] = [];
    let finishUndo!: () => void;
    const undone = new Promise<void>(resolve => { finishUndo = resolve; });
    const bridge = createEditorHostBridge(envelope, async event => {
      events.push(event);
      if (event.type === 'history-request' && event.direction === 'undo') {
        await undone;
        bridge.updateDocument({ ...envelope, revision: 8 });
      }
    });
    bridge.connect({ importProject: async () => undefined });
    await bridge.whenIdle();
    const undo = bridge.requestHistoryMove('undo');
    const redo = bridge.requestHistoryMove('redo');
    await vi.waitFor(() => expect(events.filter(e => e.type === 'history-request')).toHaveLength(1));
    finishUndo(); await Promise.all([undo, redo]);
    expect(events.at(-1)).toEqual({ type: 'history-request', direction: 'redo', baseRevision: 8 });
  });

  it('keeps snapshots blocked while a superseding import is still running', async () => {
    const envelope = documentEnvelope();
    const events: VideoEditorHostEvent[] = [];
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let calls = 0;
    const bridge = createEditorHostBridge(envelope, event => events.push(event));
    bridge.connect({ importProject: async () => { if (++calls === 2) await gate; } });
    await bridge.whenIdle();
    bridge.updateDocument({ ...envelope, revision: 1, upstreamDocument: { ...envelope.upstreamDocument, project: { script: 'first' } } });
    await vi.waitFor(() => expect(calls).toBe(2));
    bridge.updateDocument({ ...envelope, revision: 2, upstreamDocument: { ...envelope.upstreamDocument, project: { script: 'last' } } });
    bridge.onProjectSnapshot({ script: 'partial' });
    finish(); await bridge.whenIdle();
    bridge.onProjectSnapshot({ script: 'last' });
    expect(events.filter(e => e.type === 'save-request')).toEqual([]);
  });

  it('does not save hydration defaults after undo and still saves the first real edit', async () => {
    const events: VideoEditorHostEvent[] = [];
    const envelope = documentEnvelope(3);
    envelope.upstreamDocument.project = { captionSegments: [], volume: 0 };
    let projection = {};
    const bridge = createEditorHostBridge(envelope, event => events.push(event));
    bridge.connect({
      importProject: async file => {
        const { project } = JSON.parse(await file.text());
        projection = { ...project, captionStyle: { fontId: 'default' }, musicSegments: [] };
      },
      getProjectSnapshot: () => projection,
    });
    await bridge.whenIdle();
    events.length = 0;
    const undo = { ...envelope, revision: 4, upstreamDocument: { ...envelope.upstreamDocument, project: { captionSegments: [], volume: 1 } } };
    bridge.updateDocument(undo);
    await bridge.whenIdle();
    bridge.onProjectSnapshot(projection);
    expect(events).toEqual([]); // An echo here truncates the daemon's redo branch.
    bridge.onProjectSnapshot({ ...projection, captionSegments: [{ id: 'manual', text: '新修改', start: 1, end: 2 }] });
    expect(events.at(-1)).toMatchObject({ type: 'save-request', upstreamDocument: { project: { captionSegments: [{ id: 'manual' }] } } });
  });

  it('advances the reconcile base after a local snapshot so undo can restore a field equal to the old import', async () => {
    const envelope = documentEnvelope();
    const acceptProjectBaseline = vi.fn();
    const bridge = createEditorHostBridge(envelope, () => undefined);
    bridge.connect({ importProject: async () => undefined, acceptProjectBaseline });
    await bridge.whenIdle();
    const project = { visualSegments: [], captionSegments: [{ id: 'local' }] };
    bridge.onProjectSnapshot(project);
    expect(acceptProjectBaseline).toHaveBeenLastCalledWith(project);
  });

  it('imports the host document and emits saves only for later editor changes', async () => {
    const events: VideoEditorHostEvent[] = [];
    const importProject = vi.fn(async (file: File) => JSON.parse(await file.text()));
    const bridge = createEditorHostBridge(documentEnvelope(), (event) => events.push(event));

    const disconnect = bridge.connect({ importProject });
    await bridge.whenIdle();
    expect(importProject).toHaveBeenCalledTimes(1);
    expect(await importProject.mock.results[0]!.value).toMatchObject({
      format: 'timeline-studio-project',
      project: { visualSegments: [{ id: 'visual-1' }] },
    });
    expect(events).toEqual([{ type: 'ready', revision: 0 }]);

    bridge.onProjectSnapshot({ visualSegments: [{ id: 'visual-1', src: '/media/one.mp4' }] });
    expect(events).toHaveLength(1);
    bridge.onProjectSnapshot({ visualSegments: [{ id: 'visual-2', src: '/media/two.mp4' }] });
    expect(events.at(-2)).toEqual({ type: 'dirty', baseRevision: 0 });
    expect(events.at(-1)).toMatchObject({
      type: 'save-request',
      baseRevision: 0,
      upstreamDocument: {
        format: 'timeline-studio-archive',
        version: 3,
        project: { visualSegments: [{ id: 'visual-2' }] },
      },
    });

    disconnect();
  });

  it('suppresses the snapshot produced by an externally updated document', async () => {
    const events: VideoEditorHostEvent[] = [];
    const importProject = vi.fn(async () => undefined);
    const bridge = createEditorHostBridge(documentEnvelope(), (event) => events.push(event));
    bridge.connect({ importProject });
    await bridge.whenIdle();
    events.length = 0;

    const updated = documentEnvelope(2);
    updated.upstreamDocument.project = { visualSegments: [{ id: 'external' }] };
    bridge.updateDocument(updated);
    await bridge.whenIdle();
    bridge.onProjectSnapshot({ visualSegments: [{ id: 'external' }] });

    expect(importProject).toHaveBeenCalledTimes(2);
    expect(events).toEqual([]);
  });

  it('carries a project field the editor does not model through the editor\'s snapshot', async () => {
    // Field report (2026-09-06, 剪五期): `audio.set_loudness -16` landed as
    // revision 23; the console opened the cut and its first autosave saved a
    // project without `targetLoudnessLufs`, because the editor's snapshot is
    // built from the fields it knows.
    const events: VideoEditorHostEvent[] = [];
    const envelope = documentEnvelope(5);
    envelope.upstreamDocument.project = { visualSegments: [{ id: 'visual-1', src: '/media/one.mp4' }], targetLoudnessLufs: -16 };
    const bridge = createEditorHostBridge(envelope, (event) => events.push(event));
    bridge.connect({ importProject: vi.fn(async () => undefined) });
    await bridge.whenIdle();
    events.length = 0;
    // The editor's own snapshot, as it builds it: no loudness field. Nothing changed, so nothing is saved.
    bridge.onProjectSnapshot({ visualSegments: [{ id: 'visual-1', src: '/media/one.mp4' }] });
    expect(events).toEqual([]);
    // An edit is saved with the field still there.
    bridge.onProjectSnapshot({ visualSegments: [{ id: 'visual-2', src: '/media/two.mp4' }] });
    expect(events.at(-1)).toMatchObject({ type: 'save-request', upstreamDocument: { project: { visualSegments: [{ id: 'visual-2' }], targetLoudnessLufs: -16 } } });
    // A field the editor does model is the editor's: its own value wins, even when empty.
    bridge.onProjectSnapshot({ visualSegments: [{ id: 'visual-2', src: '/media/two.mp4' }], musicSegments: [] });
    const saved = events.at(-1);
    expect(saved?.type).toBe('save-request');
    if (saved?.type !== 'save-request') throw new Error('Expected the editor to emit its saved project');
    expect((saved.upstreamDocument.project as Record<string, unknown>).musicSegments).toEqual([]);
  });

  it('passes only the current document authorized assets to the importer', async () => {
    const envelope = documentEnvelope();
    envelope.assets = [{
      assetId: 'music-1',
      versionId: 'music-version-1',
      kind: 'audio',
      name: 'Theme.wav',
      url: '/api/projects/project-1/raw/music/theme.wav',
      mimeType: 'audio/wav',
      durationSeconds: 12,
    }];
    const importProject = vi.fn(async () => undefined);
    const bridge = createEditorHostBridge(envelope, () => undefined);

    bridge.connect({ importProject });
    await bridge.whenIdle();

    expect(importProject).toHaveBeenCalledWith(
      expect.any(File),
      {
        hostDocument: true,
        authorizedAssets: [expect.objectContaining({
          assetId: 'music-1',
          versionId: 'music-version-1',
          kind: 'audio',
          url: '/api/projects/project-1/raw/music/theme.wav',
        })],
      },
    );
  });

  it('updates the visible asset library when host assets change without reimporting the project', async () => {
    const bridge = createEditorHostBridge(documentEnvelope(), () => undefined);
    const importProject = vi.fn().mockResolvedValue(undefined);
    const updateAuthorizedAssets = vi.fn();
    bridge.connect({ importProject, updateAuthorizedAssets });
    await bridge.whenIdle();
    importProject.mockClear();
    updateAuthorizedAssets.mockClear();

    bridge.updateDocument({
      ...documentEnvelope(),
      assets: [{
        assetId: 'asset-new',
        versionId: 'version-new',
        kind: 'video',
        name: 'agent-output.mp4',
        url: '/api/projects/project/raw/agent-output.mp4',
        mimeType: 'video/mp4',
      }],
    });

    expect(updateAuthorizedAssets).toHaveBeenCalledWith([
      expect.objectContaining({ versionId: 'version-new' }),
    ]);
    expect(importProject).not.toHaveBeenCalled();
  });

  it('publishes the host project title on connect and updates it without reimporting the timeline', async () => {
    const bridge = createEditorHostBridge(documentEnvelope(), () => undefined);
    const importProject = vi.fn().mockResolvedValue(undefined);
    const updateProjectMetadata = vi.fn();
    bridge.connect({ importProject, updateProjectMetadata });
    await bridge.whenIdle();
    importProject.mockClear();
    updateProjectMetadata.mockClear();

    bridge.updateDocument({
      ...documentEnvelope(),
      projectTitle: 'Renamed Film',
    });

    expect(updateProjectMetadata).toHaveBeenCalledWith({ title: 'Renamed Film' });
    expect(importProject).not.toHaveBeenCalled();
  });

  it('publishes scanned project media without reimporting the timeline', async () => {
    const envelope = documentEnvelope();
    envelope.projectFiles = [{
      id: 'project-file:media/demo.mp4',
      path: 'media/demo.mp4',
      name: 'demo.mp4',
      kind: 'video',
      url: '/api/projects/project-1/raw/media/demo.mp4',
      mimeType: 'video/mp4',
    }];
    const bridge = createEditorHostBridge(envelope, () => undefined);
    const importProject = vi.fn().mockResolvedValue(undefined);
    const updateProjectFiles = vi.fn();
    bridge.connect({ importProject, updateProjectFiles });
    await bridge.whenIdle();

    expect(updateProjectFiles).toHaveBeenCalledWith(envelope.projectFiles);
    updateProjectFiles.mockClear();
    bridge.updateDocument({ ...envelope, projectFiles: [] });
    expect(updateProjectFiles).toHaveBeenCalledWith([]);
    expect(importProject).toHaveBeenCalledTimes(1);
  });

  it('routes upstream undo and redo controls through the host revision boundary', async () => {
    const events: VideoEditorHostEvent[] = [];
    const bridge = createEditorHostBridge(documentEnvelope(7), (event) => events.push(event));
    bridge.connect({ importProject: vi.fn(async () => undefined) });
    await bridge.whenIdle();
    events.length = 0;

    await bridge.requestHistoryMove('undo');
    await bridge.requestHistoryMove('redo');

    expect(events).toEqual([
      { type: 'history-request', direction: 'undo', baseRevision: 7 },
      { type: 'history-request', direction: 'redo', baseRevision: 7 },
    ]);
  });

  it('passes the host-owned capability runtime to the upstream bridge unchanged', () => {
    const capabilityRuntime = {
      start: vi.fn(async () => ({ taskId: 'task-1', signal: new AbortController().signal })),
      progress: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({ taskId: 'task-1' })),
      fail: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const bridge = createEditorHostBridge(
      documentEnvelope(),
      () => undefined,
      capabilityRuntime,
    );

    expect(bridge.capabilityRuntime).toBe(capabilityRuntime);
  });
});

describe('the host\'s render beside the browser export', () => {
  it('emits a render request at the revision the editor holds, with the panel\'s settings', async () => {
    const events: VideoEditorHostEvent[] = [];
    const bridge = createEditorHostBridge(documentEnvelope(4), (event) => events.push(event), undefined, {
      renderToProject: { label: '渲染到项目', hint: '进项目' },
    });
    expect(bridge.hostActions).toEqual({ renderToProject: { label: '渲染到项目', hint: '进项目' } });

    // Before the editor has imported the document there is nothing to render.
    bridge.requestRender({ resolution: '1080', frameRate: 30 });
    expect(events).toEqual([]);

    const disconnect = bridge.connect({ importProject: vi.fn(async (): Promise<void> => {}) });
    await bridge.whenIdle();
    bridge.requestRender({ fileName: 'final', resolution: '1080', frameRate: 30 });
    expect(events.at(-1)).toEqual({
      type: 'render-request',
      baseRevision: 4,
      settings: { fileName: 'final', resolution: '1080', frameRate: 30 },
    });
    disconnect();
  });

  it('shows nothing of the host\'s when the host offers no actions', () => {
    const bridge = createEditorHostBridge(documentEnvelope(), () => {});
    expect(bridge.hostActions).toBeUndefined();
  });

  it('lends the editor\'s toast to the host, and swallows a notice before the editor is up', async () => {
    const bridge = createEditorHostBridge(documentEnvelope(), () => {});
    bridge.notifyEditor({ message: 'too early' });
    const notify = vi.fn();
    const disconnect = bridge.connect({ importProject: vi.fn(async (): Promise<void> => {}), notify });
    bridge.notifyEditor({ message: '已存入 canvas/renders/x.mp4', tone: 'success' });
    expect(notify).toHaveBeenCalledWith({ message: '已存入 canvas/renders/x.mp4', tone: 'success' });
    disconnect();
    bridge.notifyEditor({ message: 'after' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('lends the editor\'s voice to the host, answering missing when no editor is connected', async () => {
    const bridge = createEditorHostBridge(documentEnvelope(), () => {});
    expect(await bridge.generateVoiceover('cap-1')).toEqual({ status: 'missing' });
    const generateVoiceover = vi.fn(async (captionId: string) => ({ status: 'done' as const, message: captionId }));
    const disconnect = bridge.connect({ importProject: vi.fn(async (): Promise<void> => {}), generateVoiceover });
    expect(await bridge.generateVoiceover('cap-1')).toEqual({ status: 'done', message: 'cap-1' });
    expect(generateVoiceover).toHaveBeenCalledWith('cap-1');
    disconnect();
    expect(await bridge.generateVoiceover('cap-1')).toEqual({ status: 'missing' });
  });
});

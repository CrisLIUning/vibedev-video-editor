/**
 * The editing desk's host page under DeepSeek Harness: dsh-film serves this
 * page in the 剪辑台 tab of the right sidebar (`apps/editor/index.html?cwd=
 * &project=&theme=`), and it mounts the editor bundle (`video-editor.js`,
 * beside it) on the workspace's cut.
 */

import type {
  MountedVideoEditor,
  VideoEditorHostActions,
  VideoEditorHostOptions,
} from '../../packages/video-editor-bridge/src/host-contract.ts';
import * as api from './api.ts';
import { installHostAdapter, projectId, toHostUrl, workspace } from './address.ts';
import { createCapabilityRuntime } from './runtime.ts';
import { TimelineSession } from './session.ts';
import type { NoticeTone } from './session.ts';
import { applyTheme, editorTheme, initialTheme, themeMessage } from './theme.ts';
import type { HostTheme } from './theme.ts';

/** The editor bundle's export (`packages/video-editor-bridge/src/editor-entry.jsx`). */
interface EditorModule {
  mountVideoEditor(container: HTMLElement, options: VideoEditorHostOptions): MountedVideoEditor;
}

const container = document.getElementById('editor')!;
const status = document.getElementById('status')!;
const banner = document.getElementById('banner')!;

function showStatus(text: string | null): void {
  status.hidden = text === null;
  if (text !== null) status.textContent = text;
}

function showBanner(text: string | null): void {
  banner.hidden = text === null;
  banner.textContent = text ?? '';
}

let theme: HostTheme = initialTheme();
applyTheme(theme, container);
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const next = themeMessage(event.data);
  if (next === undefined) return;
  theme = next;
  applyTheme(theme, container);
});

/** The editor's language: Chinese unless the browser asks for something else. */
const locale = /^zh\b/i.test(navigator.language) || navigator.language === '' ? 'zh-CN' : navigator.language;

async function main(): Promise<void> {
  installHostAdapter();
  if (workspace === '') throw new Error('页面地址里没有工作区');
  const project = await api.getProject();
  if (project === null) {
    showStatus('这个工作区还没有影视项目，请先在“开始”页新建。');
    return;
  }
  const session = new TimelineSession({
    api,
    boardId: project.id || projectId,
    projectId: project.id || projectId,
    title: project.title,
    aspect: project.aspectRatio,
    onSaveError: showBanner,
  });
  let editor: MountedVideoEditor | null = null;
  const notify = (message: string, tone: NoticeTone = 'info'): void => {
    if (editor?.notify) editor.notify({ message, tone });
    else if (tone === 'error') showBanner(message);
  };
  const runtime = createCapabilityRuntime({
    uploadFile: api.uploadFile,
    importWorkspaceFile: api.importWorkspaceFile,
    executeCommands: api.executeCommands,
    projectRawUrl: api.projectRawUrl,
    prepareTimeline: () => session.prepareTimeline(),
    onTimelineChanged: () => session.reloadTimeline(),
    onAssetsChanged: () => session.refreshMaterial(),
  });
  const hostActions: VideoEditorHostActions = {
    keepExport: {
      hint: '导出的文件会保存到项目的 film/canvas/renders/ 文件夹',
      keep: files => session.keepExport(files, notify),
    },
  };

  await session.load();
  const editorModule = await import(/* @vite-ignore */ new URL('video-editor.js', location.href).href) as EditorModule;
  editor = editorModule.mountVideoEditor(container, {
    hostId: `dsh-film-${session.envelope().compositeId}`,
    locale,
    theme: editorTheme(theme),
    document: session.envelope(),
    capabilityRuntime: runtime,
    hostActions,
    // No team library under DSH: the editor shows its own and the film's material.
    libraryWorkspace: { current: async () => null, subscribe: () => () => {} },
    onEvent: event => session.handleEvent(event),
  });
  session.attach(editor);
  showStatus(null);

  // The film changing on disk — an agent's edit, a generation landing — refreshes the cut and the material.
  const events = new EventSource(toHostUrl(`/api/projects/${encodeURIComponent(project.id || projectId)}/events`));
  events.addEventListener('file-changed', () => { session.requestExternalRefresh(); });

  window.addEventListener('pagehide', () => {
    events.close();
    runtime.dispose();
    void session.drainSaves().catch(() => undefined);
  });
}

main().catch((error: unknown) => {
  console.error('[dsh-film editor]', error);
  showStatus(`剪辑台打不开：${error instanceof Error ? error.message : String(error)}`);
});

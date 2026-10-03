/**
 * The editor's capability runtime under DSH: where its AI features' results
 * go (Studio's `video-editor-capability-adapter.ts` with the board's asset
 * store, `canvas-capability-api.ts`).
 *
 * The models run in the editor, in the browser. What the host owns is what
 * must outlive the tab: every output is written into the film project as a
 * file — on a board an asset is its file, `canvas-file:<path>` — and a
 * placement on the timeline is a command the plugin applies to the saved cut.
 * Tasks are this page's own (there is no daemon task table under DSH), so
 * closing the editor cancels them.
 */

import type {
  JsonObject,
  VideoEditorAssetKind,
  VideoEditorAuthorizedAsset,
  VideoEditorCapabilityOutput,
  VideoEditorCapabilityRequest,
  VideoEditorCapabilityRuntime,
} from '../../packages/video-editor-bridge/src/host-contract.ts';
import type { CommandPlanBody, UploadedFile } from './api.ts';

/** How a version names a film file. */
export const CANVAS_FILE = 'canvas-file:';
/** Where outputs and imported files are kept, relative to `film/`. */
export const MATERIAL_DIR = 'canvas/media';

export interface RuntimeHost {
  uploadFile(path: string, blob: Blob, options: { unique?: boolean }): Promise<UploadedFile>;
  importWorkspaceFile(path: string): Promise<UploadedFile>;
  executeCommands(body: CommandPlanBody): Promise<unknown>;
  projectRawUrl(path: string): string;
  /** Save what is pending and give the revision the cut is at. */
  prepareTimeline(): Promise<number>;
  /** Re-read the cut after a placement the plugin committed. */
  onTimelineChanged(): Promise<void>;
  /** Re-read the material after a new file. */
  onAssetsChanged(): Promise<void>;
}

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
/** What the timeline can hold (the plugin's command engine refuses the rest). */
const PLACEABLE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'm4a', 'mp4', 'webm', 'mov']);

/**
 * The extension a file is kept under: its own when the timeline takes it,
 * else the one its content type names.
 */
export function fileExtension(fileName: string | undefined, mimeType: string | undefined): string {
  const own = fileName?.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
  if (own !== undefined && own !== fileName?.toLowerCase() && PLACEABLE.has(own)) return own;
  const byType = mimeType ? EXTENSION_BY_TYPE[mimeType.split(';')[0]!.trim().toLowerCase()] : undefined;
  if (byType === undefined) throw new Error(`剪辑台不能保存这种文件：${mimeType || fileName || '未知类型'}`);
  return byType;
}

/** A file name stem that is safe in a path and still says what the file is. */
export function fileStem(fileName: string | undefined, fallback: string): string {
  const base = (fileName ?? '').split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[A-Za-z0-9]+$/, '');
  // Characters Windows refuses, control characters and the ones URLs would
  // need escaping for in a Host route; the rest (including CJK) stays.
  const cleaned = stem.replace(/[<>:"/\\|?*#%\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned.replace(/^[.-]+/, '') || fallback;
}

function assetKind(kind: VideoEditorAssetKind | undefined): VideoEditorAssetKind {
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'audio';
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

export function createCapabilityRuntime(host: RuntimeHost): VideoEditorCapabilityRuntime & { dispose(): void } {
  const controllers = new Map<string, AbortController>();
  const pinned = new Map<string, Promise<VideoEditorAuthorizedAsset>>();

  const assetOf = (file: UploadedFile, kind: VideoEditorAssetKind, name: string, mimeType?: string): VideoEditorAuthorizedAsset => ({
    assetId: `${CANVAS_FILE}${file.name}`,
    versionId: `${CANVAS_FILE}${file.name}`,
    kind,
    name,
    url: host.projectRawUrl(file.name),
    mimeType: mimeType || file.mime || 'application/octet-stream',
    sizeBytes: file.size,
  });

  /** Keep a blob in the film under its own name (or the first free `-N`). */
  const keep = async (blob: Blob, fileName: string | undefined, mimeType: string | undefined, fallback: string): Promise<UploadedFile> => {
    const type = mimeType || blob.type;
    const extension = fileExtension(fileName, type);
    const typed = type && blob.type !== type ? new Blob([blob], { type }) : blob;
    return host.uploadFile(`${MATERIAL_DIR}/${fileStem(fileName, fallback)}.${extension}`, typed, { unique: true });
  };

  const notifyAssets = async (): Promise<void> => {
    try { await host.onAssetsChanged(); } catch { /* the file is kept; a stale list is only a smaller library */ }
  };

  const once = (key: string, run: () => Promise<VideoEditorAuthorizedAsset>): Promise<VideoEditorAuthorizedAsset> => {
    const existing = pinned.get(key);
    if (existing) return existing;
    const pending = run();
    pinned.set(key, pending);
    pending.catch(() => { if (pinned.get(key) === pending) pinned.delete(key); });
    return pending;
  };

  const place = async (taskId: string, request: VideoEditorCapabilityRequest, items: Array<{ asset: VideoEditorAuthorizedAsset; placement: NonNullable<VideoEditorCapabilityOutput['placement']> }>) => {
    // A capability that pinned the revision it worked against keeps it (a cut
    // edited meanwhile is refused); otherwise the cut as saved now.
    const pinnedRevision = request.parameters?.timelineRevision;
    const current = await host.prepareTimeline();
    const baseRevision = typeof pinnedRevision === 'number' ? pinnedRevision : current;
    const operationId = `place:${taskId}`;
    const operations = items.map(({ asset, placement }, index) => {
      const operation: JsonObject = {
        id: items.length === 1 ? operationId : `${operationId}:${index + 1}`,
        type: 'asset.place_version',
        clipId: placement.clipId || `generated:${asset.versionId}`,
        assetId: asset.assetId,
        versionId: asset.versionId,
        track: placement.track,
        name: asset.name,
      };
      for (const [key, value] of Object.entries(placement)) {
        if (key !== 'clipId' && key !== 'track' && value !== undefined) operation[key] = value as JsonObject[string];
      }
      return operation;
    });
    await host.executeCommands({
      schemaVersion: 1,
      operationId,
      dryRun: false,
      capabilityTask: { taskId },
      plan: { schemaVersion: 1, baseRevision, operations },
    });
    try { await host.onTimelineChanged(); } catch { /* committed; a missed refresh must not read as a failed task */ }
  };

  const active = (taskId: string): AbortController => {
    const controller = controllers.get(taskId);
    if (!controller || controller.signal.aborted) throw abortError('这个任务已经结束');
    return controller;
  };

  return {
    async pinSourceAsset(request) {
      const key = request.localAssetId.trim();
      if (key === '') throw new Error('local video editor asset id is required');
      return once(key, async () => {
        const name = request.name.trim() || '导入的素材';
        const file = await keep(request.blob, request.name, request.blob.type, 'imported');
        await notifyAssets();
        return assetOf(file, request.kind, name, request.blob.type);
      });
    },

    async pinProjectFile(request) {
      const path = request.path.trim().replaceAll('\\', '/');
      if (request.projectFileId.trim() === '' || path === '') throw new Error('project file identity is required');
      return once(`project-file:${request.projectFileId}`, async () => {
        // The workspace's media/ folder is outside the film: the file is
        // copied in on first use, so the film keeps everything its cut plays.
        const file = await host.importWorkspaceFile(path);
        await notifyAssets();
        return assetOf(file, request.kind, request.name.trim() || path.split('/').pop() || path);
      });
    },

    async captureTimeline() {
      return host.prepareTimeline();
    },

    async commitTimeline(request) {
      await host.prepareTimeline();
      await host.executeCommands({
        schemaVersion: 1,
        operationId: request.operationId,
        dryRun: false,
        plan: { schemaVersion: 1, baseRevision: request.baseRevision, operations: request.operations },
      });
      await host.onTimelineChanged();
    },

    async start(request) {
      const taskId = `local-${crypto.randomUUID()}`;
      const controller = new AbortController();
      controllers.set(taskId, controller);
      void request;
      return { taskId, signal: controller.signal };
    },

    async progress() {
      // The editor shows its own progress; there is no task table to report to.
    },

    async complete(taskId, request, output) {
      const controller = active(taskId);
      const assertActive = () => { if (controller.signal.aborted) throw abortError('这个任务已经取消'); };
      try {
        if (output.blob) {
          const file = await keep(output.blob, output.fileName || `${request.capability}`, output.mimeType, request.capability);
          assertActive();
          const asset = assetOf(file, assetKind(request.outputKind), request.title, output.mimeType || output.blob.type);
          await notifyAssets();
          if (output.placement) await place(taskId, request, [{ asset, placement: output.placement }]);
          return { taskId, asset };
        }
        if (output.files?.length) {
          if (output.files.length > 64) throw new Error('video editor capability produced more than 64 files');
          const placements = output.files.filter(item => item.placement).length;
          if (placements !== 0 && placements !== output.files.length) throw new Error('multi-file capability output must place either every file or no files');
          const assets: VideoEditorAuthorizedAsset[] = [];
          const artifacts: JsonObject[] = [];
          for (const [index, item] of output.files.entries()) {
            assertActive();
            const title = item.title || `${request.title} · ${index + 1}/${output.files.length}`;
            const file = await keep(item.blob, item.fileName || `${request.capability}-${index + 1}`, item.mimeType, request.capability);
            const asset = assetOf(file, assetKind(request.outputKind), title, item.mimeType || item.blob.type);
            assets.push(asset);
            if (output.analysisResult) {
              artifacts.push({
                role: item.analysisRole ?? '',
                assetId: asset.assetId,
                versionId: asset.versionId,
                filePath: file.name,
                sourceUrl: asset.url,
                sha256: await sha256Blob(item.blob),
                mimeType: asset.mimeType,
                sizeBytes: file.size,
              });
            }
          }
          await notifyAssets();
          if (placements > 0) {
            await place(taskId, request, output.files.map((item, index) => ({ asset: assets[index]!, placement: item.placement! })));
            return { taskId, assets };
          }
          if (output.analysisResult) {
            const documentResult = {
              kind: 'video-analysis-record',
              schemaVersion: 1,
              ...structuredClone(output.analysisResult),
              artifacts,
            } as unknown as JsonObject;
            return { taskId, assets, documentResult };
          }
          return { taskId, assets };
        }
        if (output.documentResult) return { taskId, documentResult: output.documentResult };
        throw new Error('video editor capability produced neither media nor a document result');
      } finally {
        controllers.delete(taskId);
      }
    },

    async fail(taskId) {
      controllers.delete(taskId);
    },

    async cancel(taskId) {
      controllers.get(taskId)?.abort(abortError('已取消'));
      controllers.delete(taskId);
    },

    dispose() {
      for (const controller of controllers.values()) controller.abort(abortError('剪辑台已关闭'));
      controllers.clear();
    },
  };
}

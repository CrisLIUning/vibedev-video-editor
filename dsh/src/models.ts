/**
 * The editor's AI models under DeepSeek Harness. The editor asks its host to
 * get a model ready (`prepareModel`) before a capability runs — a voice, the
 * vocal remover, segmentation, a caption font. dsh-film downloads the pinned,
 * verified files once per machine and serves them from its own routes; this
 * page asks the person first. Nothing is downloaded before they agree, and
 * the answer is kept by the plugin, so each model is asked about once (all
 * caption fonts together when the person says so).
 */

import type {
  VideoEditorCapabilityRuntime,
  VideoEditorModelPrepareRequest,
  VideoEditorPreparedModel,
} from '../../packages/video-editor-bridge/src/host-contract.ts';
import { HostRequestError } from './api.ts';
import type { ModelListing, ModelTask } from './api.ts';

/** The plugin calls this needs (`api.ts` in the page). */
export interface ModelHost {
  listModels(): Promise<{ models: ModelListing[] }>;
  getModelConsent(modelId: string): Promise<{ granted: boolean }>;
  setModelConsent(modelId: string, granted: boolean, group: boolean): Promise<unknown>;
  prepareModel(modelId: string): Promise<{ taskId: string }>;
  getModelTask(taskId: string): Promise<ModelTask>;
  cancelModelTask(taskId: string): Promise<unknown>;
  modelFileUrl(modelId: string, revision: string, artifactId: string): string;
}

/** The person's answer: whether to download, and whether it covers the model's whole group. */
export interface ConsentAnswer {
  granted: boolean;
  group: boolean;
}

/** Ask the person about one model. */
export type AskConsent = (model: ModelListing) => Promise<ConsentAnswer>;

/** How often a running download is checked. */
const POLL_MS = 250;

const canceled = (label: string): DOMException => new DOMException(`没有下载 ${label}`, 'AbortError');

/** Wait, or fail with an abort error when the signal aborts first. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Model preparation canceled', 'AbortError'));
      return;
    }
    const done = (): void => {
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    function stop(): void {
      clearTimeout(timer);
      reject(new DOMException('Model preparation canceled', 'AbortError'));
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}

type ModelRuntime = Required<Pick<VideoEditorCapabilityRuntime, 'prepareModel' | 'ensureModelConsent'>>;

/**
 * The capability runtime's model half.
 * @param host - the plugin calls.
 * @param ask - shows the question to the person.
 * @param pollMs - how often a running download is checked.
 */
export function createModelAccess(host: ModelHost, ask: AskConsent, pollMs = POLL_MS): ModelRuntime {
  let listing: Promise<Map<string, ModelListing>> | undefined;
  const models = (): Promise<Map<string, ModelListing>> => {
    listing ??= host.listModels()
      .then(answer => new Map(answer.models.map(model => [model.id, model])))
      .catch((error: unknown) => {
        listing = undefined;
        throw error;
      });
    return listing;
  };
  const find = async (modelId: string): Promise<ModelListing> => {
    const model = (await models()).get(modelId);
    if (model === undefined) throw new Error(`剪辑台在 DeepSeek Harness 里不提供这个模型（${modelId}）`);
    return model;
  };

  // One question at a time: two capabilities starting together must not stack
  // dialogs, and the first answer (a whole group) may settle the second.
  let asking: Promise<unknown> = Promise.resolve();
  // A declined caption font is not asked about again until the page reloads:
  // the editor loads fonts by itself as captions play, and would ask on every
  // line. Models for something the person starts are asked about each time.
  const declined = new Set<string>();
  const obtain = (model: ModelListing, signal: AbortSignal | undefined): Promise<void> => {
    const turn = asking.then(async () => {
      signal?.throwIfAborted();
      if (declined.has(model.id)) throw canceled(model.label);
      if ((await host.getModelConsent(model.id)).granted) return;
      const answer = await ask(model);
      if (!answer.granted) {
        if (model.group !== undefined) declined.add(model.id);
        throw canceled(model.label);
      }
      signal?.throwIfAborted();
      await host.setModelConsent(model.id, true, answer.group && model.group !== undefined);
    });
    asking = turn.catch(() => undefined);
    return turn;
  };

  const follow = async (model: ModelListing, taskId: string, request: VideoEditorModelPrepareRequest): Promise<void> => {
    const { signal } = request;
    const cancel = (): void => { void host.cancelModelTask(taskId).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) {
        cancel();
        throw canceled(model.label);
      }
      for (;;) {
        const task = await host.getModelTask(taskId);
        request.onProgress?.({ progress: task.progress, phase: task.phase });
        if (task.status === 'done') return;
        if (task.status === 'failed' || task.status === 'interrupted') {
          if (signal?.aborted) throw canceled(model.label);
          const failure = new Error(task.error?.message || `${model.label} 没能准备好`) as Error & { code?: string };
          if (task.error?.code) failure.code = task.error.code;
          throw failure;
        }
        await sleep(pollMs, signal);
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };

  return {
    async ensureModelConsent(modelId, signal) {
      signal?.throwIfAborted();
      await obtain(await find(modelId), signal);
    },

    async prepareModel(request): Promise<VideoEditorPreparedModel> {
      request.signal?.throwIfAborted();
      const model = await find(request.modelId);
      let started: { taskId: string };
      try {
        started = await host.prepareModel(model.id);
      } catch (error) {
        if (!(error instanceof HostRequestError) || error.code !== 'VIDEO_EDITOR_MODEL_CONSENT_REQUIRED') throw error;
        await obtain(model, request.signal);
        request.signal?.throwIfAborted();
        started = await host.prepareModel(model.id);
      }
      await follow(model, started.taskId, request);
      return {
        modelId: model.id,
        revision: model.revision,
        artifacts: Object.fromEntries(model.artifacts.map(artifact => [artifact.id, host.modelFileUrl(model.id, model.revision, artifact.id)])),
      };
    },
  };
}

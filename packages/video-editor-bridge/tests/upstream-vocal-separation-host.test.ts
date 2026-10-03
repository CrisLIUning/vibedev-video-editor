import { describe, expect, it } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import hookSource from '../../../vendor/ai-video-editor/src/hooks/useVocalSeparation.js?raw';
import runtimeSource from '../../../vendor/ai-video-editor/src/lib/vocalSeparation.js?raw';
import workerSource from '../../../vendor/ai-video-editor/src/workers/vocal-separation.worker.js?raw';

describe('embedded vocal separation host model cache', () => {
  it('prepares the pinned model through VibeDev and forwards its graph URL to the worker', () => {
    expect(appSource).toContain('capabilityRuntime: hostBridge?.capabilityRuntime');
    expect(hookSource).toContain('modelId: "timeline-studio-vocal-remover"');
    expect(hookSource).toContain('prepared.artifacts?.["model.json"]');
    expect(runtimeSource).toContain('modelUrl');
    expect(workerSource).toContain('data.modelUrl');
    expect(workerSource).toContain('runtime.loadGraphModel(modelUrl)');
  });
});

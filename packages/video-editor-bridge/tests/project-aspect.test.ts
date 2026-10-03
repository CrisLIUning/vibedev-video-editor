import { describe, expect, it, vi } from 'vitest';

import { createEditorHostBridge } from '../src/host-project-sync.js';
import type { VideoEditorDocumentEnvelope } from '../src/host-contract.js';

// The editor keeps its own `ratioId` for the canvas and the export; the
// production keeps `brief.aspect` for generation. Until this field existed the
// two never spoke, so a 9:16 production opened on the editor's default and
// exported at that default — with nothing on screen saying the two disagreed.
//
// The value sets are identical by construction (`ProductionAspect` and the
// editor's own RATIO_OPTIONS ids), so this is a carry, not a translation.

function envelope(
  overrides: Partial<VideoEditorDocumentEnvelope> = {},
): VideoEditorDocumentEnvelope {
  return {
    schemaVersion: 1,
    projectId: 'p1',
    productionId: 'prod1',
    projectTitle: '雨夜快递员',
    compositeId: 'comp1',
    revision: 1,
    documentVersionId: 'v1',
    upstreamDocument: {},
    assets: [],
    ...overrides,
  };
}

function fakeApi() {
  return {
    importProject: vi.fn(async () => {}),
    updateAuthorizedAssets: vi.fn(),
    updateProjectFiles: vi.fn(),
    updateProjectMetadata: vi.fn(),
    getProjectSnapshot: vi.fn(() => ({})),
  };
}

describe('the production aspect reaches the editor', () => {
  it('rides along on connect, beside the title', () => {
    const api = fakeApi();
    createEditorHostBridge(envelope({ projectAspect: '9:16' }), () => {}).connect(api as never);
    expect(api.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ title: '雨夜快递员', aspect: '9:16' }),
    );
  });

  it('is omitted rather than sent empty when the host has none', () => {
    // An absent aspect must leave the editor on whatever it had. Sending
    // `undefined` would read as a value and could clear a good one.
    const api = fakeApi();
    createEditorHostBridge(envelope(), () => {}).connect(api as never);
    const [metadata] = api.updateProjectMetadata.mock.calls[0] as [Record<string, unknown>];
    expect(metadata).not.toHaveProperty('aspect');
    expect(metadata.title).toBe('雨夜快递员');
  });

  it('follows a mid-session change, so editing the brief reaches the canvas', () => {
    // BriefInspector can change the aspect while the editor is open. Carrying
    // it only on connect would leave the canvas on the old one until reload.
    const api = fakeApi();
    const bridge = createEditorHostBridge(envelope({ projectAspect: '9:16' }), () => {});
    bridge.connect(api as never);
    api.updateProjectMetadata.mockClear();

    bridge.updateDocument(envelope({ projectAspect: '16:9', revision: 2, documentVersionId: 'v2' }));
    expect(api.updateProjectMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ aspect: '16:9' }),
    );
  });
});

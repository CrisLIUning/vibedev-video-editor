import { describe, expect, it } from 'vitest';

import { createEditorHostBridge } from '../src/host-project-sync.js';
import type { VideoEditorDocumentEnvelope } from '../src/host-contract.js';

/**
 * Reported from the app: the ratio control could not be used — every pick
 * snapped straight back to the production's ratio.
 *
 * The loop: changing the ratio re-runs the effect that subscribes the editor
 * to the host, so the editor disconnects and connects again; `connect` used to
 * replay the host's metadata unconditionally; the editor adopts a host ratio
 * that differs from its own; the user's pick is gone. Every time.
 *
 * This drives the real bridge through that cycle.
 */

function envelope(overrides: Partial<VideoEditorDocumentEnvelope> = {}): VideoEditorDocumentEnvelope {
  return {
    schemaVersion: 1,
    projectId: 'p1',
    productionId: 'prod1',
    projectTitle: 'demo',
    projectAspect: '16:9',
    compositeId: 'comp1',
    revision: 1,
    documentVersionId: 'v1',
    upstreamDocument: { project: {} },
    assets: [],
    ...overrides,
  } as VideoEditorDocumentEnvelope;
}

function recordingApi() {
  const metadata: Array<{ title: string; aspect?: string }> = [];
  return {
    metadata,
    api: {
      importProject: () => {},
      updateAuthorizedAssets: () => {},
      updateProjectFiles: () => {},
      updateProjectMetadata: (next: { title: string; aspect?: string }) => {
        metadata.push(next);
      },
    },
  };
}

describe('host ratio across a reconnect', () => {
  it('publishes the production ratio once, then leaves the editor alone', () => {
    const bridge = createEditorHostBridge(envelope(), () => {});

    const first = recordingApi();
    const disconnect = bridge.connect(first.api);
    expect(first.metadata).toEqual([{ title: 'demo', aspect: '16:9' }]);

    // The user picks a different ratio. The editor re-subscribes, which is the
    // whole mechanism: nothing about the host changed.
    disconnect();
    const second = recordingApi();
    bridge.connect(second.api);

    expect(second.metadata).toHaveLength(1);
    expect(second.metadata[0]).toEqual({ title: 'demo' });
    expect(second.metadata[0]).not.toHaveProperty('aspect');
  });

  it('still delivers a ratio the production itself changed', () => {
    const bridge = createEditorHostBridge(envelope(), () => {});
    const editor = recordingApi();
    bridge.connect(editor.api);
    editor.metadata.length = 0;

    bridge.updateDocument(envelope({ projectAspect: '9:16', revision: 2 }));

    expect(editor.metadata).toEqual([{ title: 'demo', aspect: '9:16' }]);
  });

  it('does not smuggle the ratio along with a title-only change', () => {
    // A rename must not quietly reassert the production ratio over the
    // editor's own, which is the same clobber wearing a different hat.
    const bridge = createEditorHostBridge(envelope(), () => {});
    const editor = recordingApi();
    bridge.connect(editor.api);
    editor.metadata.length = 0;

    bridge.updateDocument(envelope({ projectTitle: 'renamed', revision: 2 }));

    expect(editor.metadata).toEqual([{ title: 'renamed' }]);
  });
});

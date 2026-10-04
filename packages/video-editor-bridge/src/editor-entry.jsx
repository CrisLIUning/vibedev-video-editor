import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '../../../vendor/ai-video-editor/src/App.jsx';
import upstreamCss from '../../../vendor/ai-video-editor/src/styles.css?inline';
import { registerEditorHostEnvironment } from './editor-host-environment.ts';
import { createEditorHostBridge } from './host-project-sync.ts';
import { createVideoEditorRuntime } from './editor-runtime.ts';

const runtime = createVideoEditorRuntime({
  css: upstreamCss,
  render(surface, options) {
    const unregisterEnvironment = registerEditorHostEnvironment(surface);
    const root = createRoot(surface.mountPoint);
    const hostBridge = createEditorHostBridge(
      options.document,
      options.onEvent,
      options.capabilityRuntime,
      options.hostActions,
    );
    try {
      root.render(React.createElement(App, {
        hostBridge,
        hostLibraryWorkspace: options.libraryWorkspace,
        hostLanguage: options.locale,
        hostProjectTitle: options.document.projectTitle,
      }));
    } catch (error) {
      unregisterEnvironment();
      throw error;
    }
    return {
      updateDocument(document) {
        hostBridge.updateDocument(document);
      },
      resolveCommand(result) {
        surface.mountPoint.dispatchEvent(new CustomEvent('vibedev:video-editor-command-result', {
          detail: result,
        }));
      },
      notify(notice) {
        hostBridge.notifyEditor(notice);
      },
      generateVoiceover(captionId) {
        return hostBridge.generateVoiceover(captionId);
      },
      playheadSeconds() {
        return hostBridge.playheadSeconds();
      },
      selectedClip() {
        return hostBridge.selectedClip();
      },
      flushChanges() { return hostBridge.flushChanges(); },
      whenIdle() { return hostBridge.whenIdle(); },
      unmount() {
        try {
          root.unmount();
        } finally {
          unregisterEnvironment();
        }
      },
    };
  },
});

export const mountVideoEditor = runtime.mountVideoEditor;
export { transcribeTimelineSources } from './transcription-runtime.ts';

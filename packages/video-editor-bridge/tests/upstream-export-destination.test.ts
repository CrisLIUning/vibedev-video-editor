import { describe, expect, it } from 'vitest';

import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import exportPanelSource from '../../../vendor/ai-video-editor/src/components/ExportSettingsPanel.jsx?raw';
import videoExportSource from '../../../vendor/ai-video-editor/src/hooks/useVideoExport.js?raw';

/**
 * Where the editor's own export goes.
 *
 * Standalone, the browser export ends at `downloadBlob` — the download folder,
 * which is the only place a web page can put a file. Inside VibeDev that
 * folder is outside the product: the render is not in the project, not on the
 * board, and not something the next person on the film can find. So a host may
 * take the finished files instead, and this pins the three places in the
 * vendored source that make that true — the one delivery point every export
 * path goes through, the panel saying so beside the button, and the App
 * handing the hook its host.
 */
describe('the browser export, inside a host', () => {
  it('goes through one delivery point, which offers the files to the host first', () => {
    // Four export paths (non-h264, native mp4, transcoded, webm fallback) all
    // end at `downloadArtifacts`; forking it once is what keeps them together.
    expect([...videoExportSource.matchAll(/downloadArtifacts\(/g)]).toHaveLength(4);
    expect(videoExportSource).toContain('d.hostBridge.hostActions.keepExport.keep');
    // Delivery is awaited: an export that returned before the upload finished
    // would let the editor say "done" over a file still in flight.
    for (const call of videoExportSource.matchAll(/(\w+\s+)?downloadArtifacts\(\w/g)) {
      expect(call[0].startsWith('await ')).toBe(true);
    }
  });

  it('falls back to the download when the host could not keep it', () => {
    // The file exists only in the tab's memory. A host that fails and is
    // believed loses a render nobody can cheaply re-make.
    const deliver = videoExportSource.slice(videoExportSource.indexOf('const downloadArtifacts'), videoExportSource.indexOf('const embeddedVideoAudio'));
    expect(deliver).toContain('if (kept !== false) return;');
    expect(deliver).toContain('downloadBlob(files[0].blob, files[0].name);');
  });

  it('says where the file will go, beside the button that makes it', () => {
    expect(exportPanelSource).toContain('hostBridge?.hostActions?.keepExport');
    expect(exportPanelSource).toContain('{hostKeep.hint}');
  });

  it('hands the export hook the host it has to ask', () => {
    const call = appSource.slice(appSource.indexOf('useVideoExport({'), appSource.indexOf('createTimelineReorderControls('));
    expect(call).toContain('hostBridge,');
  });
});

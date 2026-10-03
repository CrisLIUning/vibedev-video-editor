// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  mergeProjectFileUserAssets,
  mergeAuthorizedUserAssets,
} from '../../../vendor/ai-video-editor/src/lib/hostAuthorizedMedia.js';
import {
  isAssetReadyForTimeline,
  resolveAssetDragPreviewPosition,
  resolveEditorElementFromPoint,
} from '../../../vendor/ai-video-editor/src/lib/assetDragControls.js';
import {
  editorEventPathContains,
  editorViewportMatches,
  queryEditorSelector,
  resolveEditorViewport,
} from '../../../vendor/ai-video-editor/src/lib/embeddedDom.js';
import {
  editorOverlayEventIsInside,
} from '../../../vendor/ai-video-editor/src/lib/overlayEvents.js';
import {
  claimDeferredFirstVisual,
} from '../../../vendor/ai-video-editor/src/hooks/useFileUpload.js';
import {
  nextAutosaveState,
} from '../../../vendor/ai-video-editor/src/hooks/useAutosaveTimestamp.js';
import { timelineProjectFileName } from '../../../vendor/ai-video-editor/src/lib/projectFileNaming.js';
import { isFetchableAssetSource } from '../../../vendor/ai-video-editor/src/lib/remoteAssetCache.js';
import { getVisualAssetPayload } from '../../../vendor/ai-video-editor/src/lib/timeline.js';
import { resolvePendingVisualAssetId } from '../../../vendor/ai-video-editor/src/lib/assetDropActions.js';
import appSource from '../../../vendor/ai-video-editor/src/App.jsx?raw';
import fileUploadSource from '../../../vendor/ai-video-editor/src/hooks/useFileUpload.js?raw';
import timelineSource from '../../../vendor/ai-video-editor/src/components/Timeline.jsx?raw';
import editorSidebarSource from '../../../vendor/ai-video-editor/src/components/EditorSidebar.jsx?raw';
import assetDragSource from '../../../vendor/ai-video-editor/src/lib/assetDragControls.js?raw';
import timelineMoveSource from '../../../vendor/ai-video-editor/src/lib/timelineMoveControls.js?raw';
import timelineEdgeSource from '../../../vendor/ai-video-editor/src/lib/timelineEdgeAutoScroll.js?raw';
import topbarSource from '../../../vendor/ai-video-editor/src/components/Topbar.jsx?raw';
import offlineVideoExportSource from '../../../vendor/ai-video-editor/src/lib/offlineVideoExport.js?raw';
import editorEntrySource from '../src/editor-entry.jsx?raw';

const editorStylesSource = readFileSync(
  resolve(process.cwd(), '../../vendor/ai-video-editor/src/styles.css'),
  'utf8',
);

describe('embedded editor asset integration', () => {
  it('keeps the drag preview in the editor-local coordinate system', () => {
    expect(resolveAssetDragPreviewPosition(760, 420, {
      left: 500,
      top: 100,
    })).toEqual({ x: 260, y: 320 });
  });

  it('resolves pointer drop targets inside the editor shadow root', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const track = document.createElement('div');
    track.dataset.assetDropTrack = 'image';
    shadowRoot.append(track);
    const shadowElementFromPoint = vi.fn(() => track);
    Object.defineProperty(shadowRoot, 'elementFromPoint', {
      configurable: true,
      value: shadowElementFromPoint,
    });
    const documentElementFromPoint = vi.fn(() => host);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: documentElementFromPoint,
    });

    expect(resolveEditorElementFromPoint(track, 120, 80)).toBe(track);
    expect(shadowElementFromPoint).toHaveBeenCalledWith(120, 80);
    expect(documentElementFromPoint).not.toHaveBeenCalled();
    expect(queryEditorSelector(track, '[data-asset-drop-track="image"]')).toBe(track);
  });

  it('normalizes fixed menu coordinates to the embedded editor viewport', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const anchor = document.createElement('div');
    shadowRoot.append(anchor);
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      x: 360,
      y: 100,
      left: 360,
      top: 100,
      right: 1560,
      bottom: 900,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    });

    expect(resolveEditorViewport(anchor)).toMatchObject({
      left: 360,
      top: 100,
      width: 1200,
      height: 800,
    });
    expect(editorViewportMatches(anchor, { maxWidth: 760 })).toBe(false);
    expect(editorViewportMatches(anchor, { minWidth: 761 })).toBe(true);
  });

  it('recognizes context-menu events across a shadow boundary', () => {
    const menu = document.createElement('div');
    menu.className = 'timeline-context-menu';
    const button = document.createElement('button');
    menu.append(button);
    const event = { target: document.body, composedPath: () => [button, menu, document.body] };

    expect(editorEventPathContains(event, '.timeline-context-menu')).toBe(true);
  });

  it('keeps popovers open for composed events retargeted across the editor shadow boundary', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const anchor = document.createElement('button');
    const popover = document.createElement('div');
    const option = document.createElement('button');
    popover.append(option);
    shadowRoot.append(anchor, popover);

    const insidePopover = {
      target: host,
      composedPath: () => [option, popover, shadowRoot, host, document.body, document],
    };
    const insideAnchor = {
      target: host,
      composedPath: () => [anchor, shadowRoot, host, document.body, document],
    };
    const outside = {
      target: document.body,
      composedPath: () => [document.body, document],
    };

    expect(editorOverlayEventIsInside(insidePopover, [popover, anchor])).toBe(true);
    expect(editorOverlayEventIsInside(insideAnchor, [popover, anchor])).toBe(true);
    expect(editorOverlayEventIsInside(outside, [popover, anchor])).toBe(false);
    expect(topbarSource).toContain('anchorRef={projectAnchorRef}');
    expect(topbarSource).toContain('anchorRef={ratioAnchorRef}');
    expect(topbarSource).toContain('anchorRef={exportAnchorRef}');
  });

  it('uses the VibeDev project title for the editor chrome and portable project filename', () => {
    expect(timelineProjectFileName('  产品宣传:第一版?  ')).toBe('产品宣传-第一版-.timeline');
    expect(timelineProjectFileName('...')).toBe('VibeDev-影视工程.timeline');
    expect(topbarSource).toMatch(/className="project-title"[^>]*>\{projectName\}<\/div>/);
    expect(editorEntrySource).toContain('hostProjectTitle: options.document.projectTitle');
  });

  it('does not expose upstream website links in the embedded project menu', () => {
    expect(topbarSource).toContain('<small>VibeDev</small>');
    expect(topbarSource).not.toContain('className="file-menu-resources"');
    expect(topbarSource).not.toContain('href="/features/"');
  });

  it('pins toast notifications to the editor viewport rather than the timeline boundary', () => {
    const toastRule = editorStylesSource.match(/\.toast\s*\{([^}]+)\}/)?.[1] || '';
    expect(toastRule).toContain('position: fixed');
    expect(toastRule).toMatch(/bottom:\s*max\(22px,\s*env\(safe-area-inset-bottom\)\)/);
    expect(toastRule).not.toContain('--timeline-panel-height');
  });

  it('renders export progress on an opaque host-themed surface', () => {
    const cardRule = editorStylesSource.match(/\.export-progress-card\s*\{([^}]+)\}/)?.[1] || '';
    expect(cardRule).toContain('background: var(--vibedev-editor-elevated');
    expect(cardRule).not.toMatch(/background:\s*(?:transparent|none)/);
  });

  it('closes sequential WebCodecs readers and cancels an export output at most once', () => {
    expect(offlineVideoExportSource).toContain('sequentialFrames?.dispose');
    expect(offlineVideoExportSource).toContain('cancelOutputOnce');
  });

  it('shows current host assets while preserving local uploads and replacing stale host versions', () => {
    const local = { id: 'local-1', type: 'image', src: 'blob:local', name: 'local.png', blob: new Blob() };
    const stale = { id: 'vibedev-version-old', type: 'video', src: '/api/old.mp4', name: 'old.mp4', hostAuthorized: true };
    const assets = mergeAuthorizedUserAssets([local, stale], [{
      assetId: 'asset-1',
      versionId: 'version-new',
      kind: 'video',
      name: 'agent-output.mp4',
      url: '/api/projects/project/raw/agent-output.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 12,
    }]);

    expect(assets).toEqual(expect.arrayContaining([
      local,
      expect.objectContaining({
        id: 'vibedev-version-new',
        assetId: 'asset-1',
        versionId: 'version-new',
        assetVersionId: 'version-new',
        type: 'video',
        src: '/api/projects/project/raw/agent-output.mp4',
        sourceUrl: '/api/projects/project/raw/agent-output.mp4',
        duration: 12,
        hostAuthorized: true,
      }),
    ]));
    expect(assets.some((asset) => asset.id === 'vibedev-version-old')).toBe(false);
  });

  it('promotes a pinned local upload instead of duplicating its authorized host entry', () => {
    const local = {
      id: 'local-1', type: 'video', src: 'blob:local', name: 'local.mp4', blob: new Blob(),
      assetId: 'asset-1', assetVersionId: 'version-1', sourceUrl: '/api/project/local.mp4',
    };
    const assets = mergeAuthorizedUserAssets([local], [{
      assetId: 'asset-1', versionId: 'version-1', kind: 'video', name: 'local.mp4',
      url: '/api/project/local.mp4', mimeType: 'video/mp4', durationSeconds: 4,
    }]);

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: 'local-1', assetId: 'asset-1', assetVersionId: 'version-1',
      sourceUrl: '/api/project/local.mp4', hostAuthorized: true,
    });
    expect(assets[0]!.blob).toBe(local.blob);
  });

  it('refreshes the actual preview source when a historical host asset is reauthorized', () => {
    const assets = mergeAuthorizedUserAssets([{
      id: 'vibedev-version-1',
      type: 'image',
      src: 'blob:expired-preview',
      originalSrc: 'blob:expired-original',
      previewSrc: 'blob:expired-thumbnail',
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      hostAuthorized: true,
    }], [{
      assetId: 'asset-1',
      versionId: 'version-1',
      kind: 'image',
      name: 'restored.png',
      url: '/api/projects/project/raw/restored.png',
      mimeType: 'image/png',
    }]);

    expect(assets[0]).toMatchObject({
      src: '/api/projects/project/raw/restored.png',
      originalSrc: '/api/projects/project/raw/restored.png',
      previewSrc: '/api/projects/project/raw/restored.png',
    });
  });

  it('keeps a host-bound local upload off every timeline until its AssetVersion exists', () => {
    expect(isAssetReadyForTimeline({
      id: 'local-1', type: 'video', requiresPin: true, pinning: true,
    })).toBe(false);
    expect(isAssetReadyForTimeline({
      id: 'local-1', type: 'video', requiresPin: true, pinError: true,
    })).toBe(false);
    expect(isAssetReadyForTimeline({
      id: 'local-1', type: 'video', requiresPin: true, assetVersionId: 'version-1',
    })).toBe(true);
    expect(fileUploadSource).toContain('if (shouldAutoAddFirstVisual && !requiresPin)');
    expect(fileUploadSource).toContain('void pinAsset({ ...asset, ...patch }, { autoAdd:');
    expect(fileUploadSource.indexOf('const pinned = await deps.capabilityRuntime.pinSourceAsset')).toBeLessThan(
      fileUploadSource.indexOf('deps.appendVisualAssetToTimeline({ ...asset, ...identity })'),
    );
  });

  it('projects scanned media files into the editor library without inventing an AssetVersion', () => {
    const assets = mergeProjectFileUserAssets([], [{
      id: 'project-file:media/demo.mp4',
      path: 'media/demo.mp4',
      name: 'demo.mp4',
      kind: 'video',
      url: '/api/projects/project/raw/media/demo.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
    }]);

    expect(assets).toEqual([expect.objectContaining({
      id: 'project-file:media/demo.mp4',
      type: 'video',
      src: '/api/projects/project/raw/media/demo.mp4',
      projectFilePath: 'media/demo.mp4',
      requiresPin: true,
    })]);
  });

  it('atomically admits only one still-present deferred first visual', () => {
    const claim = { current: '' };
    const assets = [{ id: 'local-1' }, { id: 'local-2' }];

    expect(claimDeferredFirstVisual(claim, 'local-1', [], assets)).toBe(true);
    expect(claimDeferredFirstVisual(claim, 'local-2', [], assets)).toBe(false);
    expect(claim.current).toBe('local-1');

    claim.current = '';
    expect(claimDeferredFirstVisual(claim, 'local-deleted', [], assets)).toBe(false);
    expect(claimDeferredFirstVisual(claim, 'local-2', [{ id: 'already-on-timeline' }], assets)).toBe(false);
  });

  it('advances the host save signal even when two edits share the same displayed second', () => {
    const timestamp = new Date('2026-08-24T11:20:00.100+08:00');
    const first = nextAutosaveState({ label: '11:20:00', revision: 4 }, timestamp);
    const second = nextAutosaveState(first, timestamp);

    expect(first.label).toBe(second.label);
    expect(second.revision).toBe(6);
  });

  it('includes pinned audio, music and sticker identity changes in the host autosave signal', () => {
    const appAutosave = appSource.match(/useAutosaveTimestamp\(\[([\s\S]*?)\]\)/)?.[1] || '';
    expect(appAutosave).toContain('audioSegments');
    expect(appAutosave).toContain('musicSegments');
    expect(appAutosave).toContain('stickerSegments');
    expect(appAutosave).toContain('visualSegments');
    expect(appAutosave).toContain('visualOverlaySegments');
  });

  it('treats authorized same-origin project media as fetchable without opening arbitrary paths', () => {
    expect(isFetchableAssetSource({ src: '/api/projects/p/raw/video.mp4', hostAuthorized: true })).toBe(true);
    expect(isFetchableAssetSource({ src: '/api/projects/p/raw/video.mp4' })).toBe(false);
    expect(isFetchableAssetSource({ src: 'https://commons.example/video.mp4' })).toBe(true);
  });

  it('persists the authorized AssetVersion identity instead of a transient blob URL', () => {
    const payload = getVisualAssetPayload({
      id: 'vibedev-version-1',
      assetId: 'asset-1',
      versionId: 'version-1',
      type: 'video',
      src: 'blob:transient-preview',
      sourceUrl: '/api/projects/project/raw/generated.mp4',
      duration: 8,
    });
    const { src: _src, blob: _blob, ...persisted } = payload;

    expect(persisted).toMatchObject({
      assetId: 'asset-1',
      assetVersionId: 'version-1',
      sourceUrl: '/api/projects/project/raw/generated.mp4',
    });
  });

  it('finishes a pending host visual by its canonical asset id', () => {
    expect(resolvePendingVisualAssetId(
      { id: 'segment-1', assetId: 'asset-1' },
      { id: 'vibedev-version-1', assetId: 'asset-1' },
    )).toBe('asset-1');
  });

  it('does not use the browser window width for embedded editor interactions', () => {
    for (const source of [timelineSource, editorSidebarSource, assetDragSource, timelineMoveSource, timelineEdgeSource]) {
      expect(source).not.toMatch(/matchMedia[^\n]*(?:min|max)-width/i);
    }
    expect(timelineSource).toContain('isMobileViewport');
    expect(editorSidebarSource).toContain('d.isCompactViewport');
    expect(timelineEdgeSource).toContain('editorViewportMatches');
  });
});

import { describe, expect, it } from 'vitest';

import {
  assertEditorBase,
  transformEmbeddedPublicRootUrls,
  transformEmbeddedVendorSource,
} from '../build/embed-source-transform';
import { assertClassicMediaPipeLoader } from '../build/mediapipe-loader';
import buildConfigSource from '../vite.config.mjs?raw';
import hostBuildScriptSource from '../../../scripts/build-ai-video-editor-host.ts?raw';

describe('embedded editor React runtime build boundary', () => {
  it('routes only upstream portal imports through the host shim', () => {
    expect(buildConfigSource).toContain("jsx: 'automatic'");
    expect(buildConfigSource).toContain("jsxImportSource: 'react'");
    expect(buildConfigSource).toContain('const embeddedVendorBoundaryPlugin');
    expect(buildConfigSource).toContain('transformEmbeddedVendorSource');
    expect(buildConfigSource).toContain('embeddedLanguagePlugin');
    expect(buildConfigSource).toContain('embeddedVendorBoundaryPlugin');
    expect(buildConfigSource).toContain(
      "{ find: /^react-dom$/, replacement: path.join(vendorModules, 'react-dom', 'index.js') }",
    );
    expect(buildConfigSource).not.toContain(
      "{ find: /^react-dom$/, replacement: path.join(packageRoot, 'src', 'react-dom-shim.js') }",
    );
  });

  it('rewrites upstream portals and public-root assets before Vite resolves them', () => {
    const transformed = transformEmbeddedVendorSource(
      'import { createPortal } from "react-dom"; const a = "/assets/a.png"; const b = "/vendor/m.wasm";',
      'C:\\repo\\vendor\\ai-video-editor\\src\\components\\panels.jsx',
      {
        vendorSourceRoot: 'C:/repo/vendor/ai-video-editor/src',
        reactDomShim: 'C:/repo/packages/video-editor-bridge/src/react-dom-shim.js',
      },
    );

    expect(transformed?.code).toContain('from "C:/repo/packages/video-editor-bridge/src/react-dom-shim.js"');
    expect(transformed?.code).toContain('"/video-editor/assets/a.png"');
    expect(transformed?.code).toContain('"/video-editor/vendor/m.wasm"');
    expect(transformEmbeddedVendorSource('const a = "/assets/a.png";', 'C:/repo/apps/web/a.ts', {
      vendorSourceRoot: 'C:/repo/vendor/ai-video-editor/src',
      reactDomShim: 'C:/repo/shim.js',
    })).toBeNull();
  });

  it('rewrites copied manifests and worker bundles without double-prefixing existing URLs', () => {
    expect(transformEmbeddedPublicRootUrls(JSON.stringify({
      sticker: '/assets/stickers/trend-flame.png',
      worker: '/vendor/opencv.js',
      ready: '/video-editor/assets/already-fixed.png',
    }))).toBe(JSON.stringify({
      sticker: '/video-editor/assets/stickers/trend-flame.png',
      worker: '/video-editor/vendor/opencv.js',
      ready: '/video-editor/assets/already-fixed.png',
    }));
    expect(buildConfigSource).toContain('rewriteEmbeddedBundlePublicRootsPlugin');
    expect(buildConfigSource).toContain('transformEmbeddedPublicRootUrls');
    expect(transformEmbeddedPublicRootUrls('const remote = "https://cdn.example/assets/model.bin";'))
      .toContain('https://cdn.example/assets/model.bin');
  });

  it('rewrites to the base another host serves the editor at, once', () => {
    const base = '/api/dsh-film/apps/editor/';
    const once = transformEmbeddedPublicRootUrls('a("/assets/a.png");b(`/vendor/m.wasm`)', base);
    expect(once).toBe('a("/api/dsh-film/apps/editor/assets/a.png");b(`/api/dsh-film/apps/editor/vendor/m.wasm`)');
    expect(transformEmbeddedPublicRootUrls(once, base)).toBe(once);
    expect(transformEmbeddedVendorSource('const a = "/assets/a.png";', 'C:/repo/vendor/ai-video-editor/src/a.js', {
      vendorSourceRoot: 'C:/repo/vendor/ai-video-editor/src',
      reactDomShim: 'C:/repo/shim.js',
      base,
    })?.code).toBe('const a = "/api/dsh-film/apps/editor/assets/a.png";');
    expect(() => assertEditorBase('api/editor')).toThrow('absolute path');
    expect(() => assertEditorBase('/api/editor')).toThrow('trailing slash');
    expect(assertEditorBase(base)).toBe(base);
  });

  it('drops the MediaPipe module build only while every loader asks for the classic one', () => {
    // forVisionTasks(root, useModule = false) picks vision_wasm_module_internal
    // only when useModule is passed.
    expect(buildConfigSource).toContain("'vendor/mediapipe/vision/vision_wasm_module_internal.wasm'");
    expect(buildConfigSource).toContain('assertClassicMediaPipeLoader');
    expect(assertClassicMediaPipeLoader([
      'const r=await ph.forVisionTasks(t);',
      'Promise.all([hh(t),Lt.forVisionTasks(uh)])',
    ])).toBe(2);
    expect(() => assertClassicMediaPipeLoader(['Lt.forVisionTasks(uh,!0)']))
      .toThrow('asks for the MediaPipe module build');
    expect(() => assertClassicMediaPipeLoader(['FilesetResolver.forVisionTasks(root, true)']))
      .toThrow('asks for the MediaPipe module build');
    expect(() => assertClassicMediaPipeLoader(['const vision = null;']))
      .toThrow('found no MediaPipe loader');
  });

  it('keeps the bridge contract output when rebuilding the nested editor bundle', () => {
    expect(buildConfigSource).toContain('emptyOutDir: false');
    expect(hostBuildScriptSource).toContain("rm(outputRoot, { recursive: true, force: true })");
    expect(hostBuildScriptSource).not.toContain("rm(path.join(repoRoot, 'packages', 'video-editor-bridge', 'dist')");
  });
});

import { assertClassicMediaPipeLoader } from './build/mediapipe-loader.ts';
import { whisperOrtAliases } from './build/whisper-ort-alias.ts';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_EDITOR_BASE,
  assertEditorBase,
  transformEmbeddedPublicRootUrls,
  transformEmbeddedVendorSource,
} from './build/embed-source-transform.ts';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const vendorRoot = path.join(repoRoot, 'vendor', 'ai-video-editor');
const vendorModules = path.join(vendorRoot, 'node_modules');
const vendorSourceRoot = path.join(vendorRoot, 'src').replaceAll('\\', '/');
const reactDomShim = path.join(packageRoot, 'src', 'react-dom-shim.js');
const editorLifecycleHook = path.join(vendorRoot, 'src', 'hooks', 'useEditorLifecycle.js').replaceAll('\\', '/');
// Studio serves the editor at /video-editor/ from the bridge's dist/editor.
// Another host builds for its own base (VIDEO_EDITOR_BASE) into its own
// folder (VIDEO_EDITOR_OUT_DIR): the base is baked into worker URLs and the
// rewritten public-root literals, so it cannot be chosen at run time.
const editorBase = assertEditorBase(process.env.VIDEO_EDITOR_BASE || DEFAULT_EDITOR_BASE);
const editorOutputRoot = process.env.VIDEO_EDITOR_OUT_DIR
  ? path.resolve(process.env.VIDEO_EDITOR_OUT_DIR)
  : path.join(packageRoot, 'dist', 'editor');
const excludedPublicAssets = [
  'assets/voice-samples/ko_KR-mms-medium.mp3',
  'assets/voice-samples/vi_VN-mms-medium.mp3',
  'assets/voice-samples/ru_RU-mms-medium.mp3',
  'assets/voice-samples/th_TH-mms-medium.mp3',
  'assets/voice-samples/ja_JP-supertonic-f1.mp3',
  'assets/voice-avatars/ko_KR-mms-medium.webp',
  'assets/voice-avatars/vi_VN-mms-medium.webp',
  'assets/voice-avatars/ru_RU-mms-medium.webp',
  'assets/voice-avatars/th_TH-mms-medium.webp',
  'assets/voice-avatars/ja_JP-supertonic-f1.webp',
  'assets/effects/models/selfie_segmenter.tflite',
  // MediaPipe falls back to this build only when WebAssembly SIMD is missing,
  // which Electron's Chromium always has (10.6 MiB).
  'vendor/mediapipe/vision/vision_wasm_nosimd_internal.js',
  'vendor/mediapipe/vision/vision_wasm_nosimd_internal.wasm',
  // Loaded only by forVisionTasks(root, true); every call site asks for the
  // classic build, which assertClassicMediaPipeLoader checks (11.3 MiB).
  'vendor/mediapipe/vision/vision_wasm_module_internal.js',
  'vendor/mediapipe/vision/vision_wasm_module_internal.wasm',
];

// Vite emits every wasm an imported module names. The Whisper alias points at
// an unminified ORT build whose source names the plain CPU wasm, so Vite emits
// that file although nothing shipped loads it (10.6 MiB); minification drops
// the only reference. Emitted wasm that no output file names is removed, and
// an unexpected one fails the build instead of vanishing unnoticed.
const expectedUnreferencedWasm = [/^ort-wasm-simd-threaded-[\w-]+\.wasm$/];

const embeddedLanguagePlugin = {
  name: 'vibedev-embedded-editor-language',
  enforce: 'pre',
  transform(source, id) {
    if (id.split('?')[0].replaceAll('\\', '/') !== editorLifecycleHook) return null;
    const assignment = 'document.documentElement.lang = d.activeLanguage === "zh" ? "zh-CN" : d.activeLanguage;';
    if (!source.includes(assignment)) {
      throw new Error('upstream editor language hook changed; update the VibeDev host adapter');
    }
    return {
      code: `import { setEmbeddedEditorLanguage } from "../../../../packages/video-editor-bridge/src/editor-host-environment.ts";\n${source.replace(
        assignment,
        'setEmbeddedEditorLanguage(d.activeLanguage === "zh" ? "zh-CN" : d.activeLanguage);',
      )}`,
      map: null,
    };
  },
};

// Keep authored portal targets and public-root URLs inside the embedded editor
// boundary. A resolver-only plugin loses to Vite's react-dom alias ordering,
// so transform the vendored source before dependency resolution instead.
const embeddedVendorBoundaryPlugin = {
  name: 'vibedev-embedded-editor-vendor-boundary',
  enforce: 'pre',
  transform(source, id) {
    return transformEmbeddedVendorSource(source, id, { vendorSourceRoot, reactDomShim, base: editorBase });
  },
};

async function editorTextFiles(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.vite') await editorTextFiles(filePath, found);
    } else if (embeddedTextAssetExtensions.has(path.extname(entry.name))) {
      found.push(filePath);
    }
  }
  return found;
}

async function pruneUnreferencedWasm(texts) {
  const assets = path.join(editorOutputRoot, 'assets');
  const emitted = (await readdir(assets)).filter((name) => name.endsWith('.wasm'));
  for (const name of emitted) {
    if (texts.some((text) => text.includes(name))) continue;
    if (!expectedUnreferencedWasm.some((pattern) => pattern.test(name))) {
      throw new Error(`the editor build emitted ${name}, which no output file references; check it before shipping or dropping it`);
    }
    await rm(path.join(assets, name), { force: true });
  }
}

const pruneExcludedPublicAssetsPlugin = {
  name: 'vibedev-prune-excluded-public-assets',
  async closeBundle() {
    await Promise.all(
      excludedPublicAssets.map((relativePath) =>
        rm(path.join(editorOutputRoot, relativePath), { force: true }),
      ),
    );
    const texts = await Promise.all((await editorTextFiles(editorOutputRoot)).map((file) => readFile(file, 'utf8')));
    assertClassicMediaPipeLoader(texts);
    await pruneUnreferencedWasm(texts);
  },
};

const embeddedTextAssetExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs']);

async function rewriteEmbeddedPublicRoots(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteEmbeddedPublicRoots(filePath);
      return;
    }
    if (!embeddedTextAssetExtensions.has(path.extname(entry.name).toLowerCase())) return;
    const source = await readFile(filePath, 'utf8');
    const rewritten = transformEmbeddedPublicRootUrls(source, editorBase);
    if (rewritten !== source) await writeFile(filePath, rewritten, 'utf8');
  }));
}

const rewriteEmbeddedBundlePublicRootsPlugin = {
  name: 'vibedev-rewrite-embedded-bundle-public-roots',
  async closeBundle() {
    try { await rewriteEmbeddedPublicRoots(editorOutputRoot); } catch(error) { if(error.code !== "ENOENT") throw error; }
  },
};

export default {
  root: repoRoot,
  base: editorBase,
  publicDir: path.join(vendorRoot, 'public'),
  plugins: [
    embeddedLanguagePlugin,
    embeddedVendorBoundaryPlugin,
    rewriteEmbeddedBundlePublicRootsPlugin,
    pruneExcludedPublicAssetsPlugin,
  ],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: [
      ...whisperOrtAliases(vendorRoot),
      { find: /^react$/, replacement: path.join(vendorModules, 'react', 'index.js') },
      { find: /^react\/(.*)$/, replacement: `${path.join(vendorModules, 'react')}/$1` },
      { find: /^react-dom$/, replacement: path.join(vendorModules, 'react-dom', 'index.js') },
      { find: /^react-dom\/(.*)$/, replacement: `${path.join(vendorModules, 'react-dom')}/$1` },
    ],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    outDir: editorOutputRoot,
    // This output is nested under the bridge contract's dist directory.
    // Vite's default cleanup would erase dist/index.mjs and declarations,
    // making subsequent workspace builds fail and causing Windows EBUSY
    // retries when tools-pack rematerializes the parent directory.
    emptyOutDir: false,
    copyPublicDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    rollupOptions: {
      input: path.join(packageRoot, 'src', 'editor-entry.jsx'),
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: 'video-editor.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
};

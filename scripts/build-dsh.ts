/**
 * The editor as the dsh-film plugin serves it in DeepSeek Harness: the editor
 * bundle built for the plugin's base, plus the host page that mounts it
 * (`dsh/`), all in `dist-dsh/`. dsh-film copies that folder to `apps/editor`.
 *
 * Beside the host page (`index.html` + `host.js`) sits the caption runner
 * (`caption-runner.html` + `caption-runner.js`): the hidden page dsh-film's
 * client half mounts to run one speech-recognition job with the same bundle.
 *
 *   npm run build:dsh                 # editor + host page
 *   DSH_REUSE_EDITOR=1 npm run build:dsh   # host page only, keeps the editor bundle
 */

import { spawn } from 'node:child_process';
import { copyFile, lstat, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

import { assertBuildInputs, measureBundle, readManifest, resolveNpmInvocation } from './ai-video-editor-vendor.ts';

/** Where dsh-film serves the editor (`apps/editor` under its route prefix). */
export const DSH_EDITOR_BASE = '/api/dsh-film/apps/editor/';

/** Path segments the DSH Host can route; other names cannot be served. */
const ROUTABLE_SEGMENT = /^[A-Za-z0-9_$.-]+$/;
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.mjs']);
const MODEL_WEIGHT_EXTENSIONS = new Set(['.onnx', '.tflite', '.safetensors', '.pt', '.pth']);

/**
 * The upstream project's own website, which its public folder carries and
 * Vite copies: pages, crawler files, the standalone app's manifest, icons and
 * service worker. The embedded editor uses none of them.
 */
const UPSTREAM_SITE = [
  'about', 'articles', 'faq', 'features', 'how-it-works', 'privacy', 'icons',
  'geo.css', 'llms.txt', 'llms-full.txt', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'model-cache-sw.js',
  'assets/reference-timeline-studio.png',
];

const repoRoot = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(repoRoot, 'dist-dsh');

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function run(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit ${String(code)}`}`));
    });
  });
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await listFiles(root, child));
    else found.push(child);
  }
  return found;
}

async function buildEditor(): Promise<void> {
  const manifest = await readManifest(repoRoot);
  const vendorRoot = path.join(repoRoot, 'vendor', 'ai-video-editor');
  await assertBuildInputs(vendorRoot, manifest);
  const viteCli = path.join(vendorRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!(await exists(viteCli))) {
    const npm = await resolveNpmInvocation();
    await run(npm.executable, [...npm.argsPrefix, 'ci', '--ignore-scripts=false', '--no-audit', '--no-fund'], vendorRoot);
  }
  await rm(outputRoot, { recursive: true, force: true });
  await run(
    process.execPath,
    ['--max-old-space-size=8192', viteCli, 'build', '--config', path.join(repoRoot, 'packages', 'video-editor-bridge', 'vite.config.mjs')],
    repoRoot,
    { ...process.env, VIDEO_EDITOR_BASE: DSH_EDITOR_BASE, VIDEO_EDITOR_OUT_DIR: outputRoot },
  );
  await Promise.all(UPSTREAM_SITE.map(entry => rm(path.join(outputRoot, entry), { recursive: true, force: true })));
}

/** The pages beside the editor bundle: each an HTML file and its script. */
const HOST_PAGES = [
  { html: 'index.html', script: 'host' },
  { html: 'caption-runner.html', script: 'caption-runner' },
] as const;

async function buildHostPage(): Promise<void> {
  await build({
    entryPoints: Object.fromEntries(HOST_PAGES.map(page => [page.script, path.join(repoRoot, 'dsh', 'src', `${page.script}.ts`)])),
    outdir: outputRoot,
    entryNames: '[name]',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  });
  for (const page of HOST_PAGES) await copyFile(path.join(repoRoot, 'dsh', page.html), path.join(outputRoot, page.html));
}

async function check(): Promise<void> {
  const files = await listFiles(outputRoot);
  for (const required of ['index.html', 'host.js', 'caption-runner.html', 'caption-runner.js', 'video-editor.js']) {
    if (!files.includes(required)) throw new Error(`dist-dsh is missing ${required}`);
  }
  const unroutable = files.filter(file => !file.split('/').every(segment => ROUTABLE_SEGMENT.test(segment)));
  if (unroutable.length > 0) throw new Error(`file names the DSH Host cannot route: ${unroutable.slice(0, 5).join(', ')}`);
  const ffmpeg = files.filter(file => /ffmpeg/i.test(file));
  if (ffmpeg.length > 0) throw new Error(`FFmpeg files in the bundle: ${ffmpeg.join(', ')}`);
  const weights = files.filter(file => MODEL_WEIGHT_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (weights.length > 0) throw new Error(`model weights in the bundle: ${weights.join(', ')}`);
  // Studio's base baked in anywhere would point the editor at a path dsh-film does not serve.
  for (const file of files.filter(name => TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()))) {
    const text = await readFile(path.join(outputRoot, file), 'utf8');
    if (/["'`(]\/video-editor\//.test(text)) throw new Error(`${file} still names Studio's /video-editor/ base`);
    if (/@ffmpeg\/core/.test(text)) throw new Error(`${file} still loads @ffmpeg/core`);
  }
}

async function main(): Promise<void> {
  if (process.env.DSH_REUSE_EDITOR === '1' && await exists(path.join(outputRoot, 'video-editor.js'))) {
    console.log('[build-dsh] reusing the editor bundle in dist-dsh');
  } else {
    await buildEditor();
  }
  await buildHostPage();
  await check();
  const measurement = await measureBundle(outputRoot);
  console.log(JSON.stringify({ status: 'built', outputDirectory: 'dist-dsh', base: DSH_EDITOR_BASE, ...measurement }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`[build-dsh] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

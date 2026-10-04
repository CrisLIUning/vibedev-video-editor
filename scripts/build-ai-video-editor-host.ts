import { spawn } from 'node:child_process';
import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  assertBuildInputs,
  measureBundle,
  readManifest,
  resolveNpmInvocation,
} from './ai-video-editor-vendor.ts';
import { assertNoEspeakNg } from '../packages/video-editor-bridge/build/espeak-ng-markers.ts';

const excludedVoicePreviewAssets = [
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
] as const;
const MODEL_WEIGHT_EXTENSIONS = new Set(['.onnx', '.tflite', '.safetensors', '.pt', '.pth']);

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function findBundledModelWeights(root: string, relativeRoot = ''): Promise<string[]> {
  const directory = path.join(root, relativeRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) return findBundledModelWeights(root, relativePath);
    return MODEL_WEIGHT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [relativePath] : [];
  }));
  return nested.flat();
}

async function run(executable: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `${executable} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit ${String(code)}`}`,
      ));
    });
  });
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const manifest = await readManifest(repoRoot);
  const vendorRoot = path.join(repoRoot, 'vendor', 'ai-video-editor');
  await assertBuildInputs(vendorRoot, manifest);

  const viteCli = path.join(vendorRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!(await exists(viteCli))) {
    const npm = await resolveNpmInvocation();
    await run(npm.executable, [...npm.argsPrefix, 'ci', '--ignore-scripts=false'], vendorRoot);
  }

  const outputRoot = path.join(repoRoot, 'packages', 'video-editor-bridge', 'dist', 'editor');
  // Vite cannot clean the parent dist directory because it also contains the
  // bridge contract, but hashed editor chunks must not accumulate between
  // builds. Clean only the nested, generated editor output.
  await rm(outputRoot, { recursive: true, force: true });
  await run(
    process.execPath,
    [
      '--max-old-space-size=8192',
      viteCli,
      'build',
      '--config',
      path.join(repoRoot, 'packages', 'video-editor-bridge', 'vite.config.mjs'),
    ],
    repoRoot,
  );

  if (await exists(path.join(outputRoot, 'models'))) {
    throw new Error('embedded editor bundle unexpectedly contains model weights');
  }
  if (!(await exists(path.join(outputRoot, 'video-editor.js')))) {
    throw new Error('embedded editor bundle is missing video-editor.js');
  }
  for (const relativePath of excludedVoicePreviewAssets) {
    if (await exists(path.join(outputRoot, relativePath))) {
      throw new Error(`embedded editor bundle unexpectedly contains excluded voice asset: ${relativePath}`);
    }
  }
  const bundledModelWeights = await findBundledModelWeights(outputRoot);
  if (bundledModelWeights.length > 0) {
    throw new Error(`embedded editor bundle unexpectedly contains model weight: ${bundledModelWeights.join(', ')}`);
  }
  await assertNoEspeakNg(outputRoot, 'embedded editor bundle');
  const measurement = await measureBundle(outputRoot);
  if (measurement.totalBytes === 0 || measurement.categories.wasm === 0) {
    throw new Error('embedded editor bundle is missing required runtime assets');
  }
  console.log(JSON.stringify({
    status: 'built',
    commit: manifest.commit,
    outputDirectory: 'packages/video-editor-bridge/dist/editor',
    modelWeightsBundled: false,
    ...measurement,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`[ai-video-editor-host] build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

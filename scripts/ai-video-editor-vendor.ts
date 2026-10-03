import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export type AiVideoEditorManifest = {
  schemaVersion: 1;
  repository: string;
  commit: string;
  sourceDirectory: "vendor/ai-video-editor";
  license: "MIT";
  include: string[];
  exclude: string[];
  build: {
    packageManager: "npm";
    command: ["npm", "run", "build"];
    outputDirectory: "dist";
  };
  distribution: {
    bundleFfmpegWasm: boolean;
    bundleRuntimeWasm: boolean;
    bundleModels: false;
  };
};

const auditedRepository = "https://github.com/MartinDelophy/ai-video-editor.git";
const requiredIncludes = [
  "src",
  "public",
  "scripts",
  "skills",
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.mjs",
  "tsconfig.json",
  ".gitignore",
  "LICENSE",
  "MODEL_LICENSES.md",
  "README.md",
] as const;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return [...value];
}

export function validateManifest(value: unknown): AiVideoEditorManifest {
  const manifest = requireRecord(value, "manifest");
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (manifest.repository !== auditedRepository) {
    throw new Error(`repository must be the audited HTTPS GitHub repository ${auditedRepository}`);
  }
  if (typeof manifest.commit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.commit)) {
    throw new Error("commit must be a lowercase 40 character Git commit");
  }
  if (manifest.sourceDirectory !== "vendor/ai-video-editor") {
    throw new Error("sourceDirectory must be vendor/ai-video-editor");
  }
  if (manifest.license !== "MIT") throw new Error("license must be MIT");

  const include = requireStringArray(manifest.include, "include");
  for (const requiredPath of requiredIncludes) {
    if (!include.includes(requiredPath)) throw new Error(`include must contain ${requiredPath}`);
  }
  const exclude = requireStringArray(manifest.exclude, "exclude");
  if (!exclude.includes("public/models")) throw new Error("exclude must contain public/models");

  const build = requireRecord(manifest.build, "build");
  const command = build.command;
  if (
    build.packageManager !== "npm" ||
    !Array.isArray(command) ||
    command.length !== 3 ||
    command[0] !== "npm" ||
    command[1] !== "run" ||
    command[2] !== "build" ||
    build.outputDirectory !== "dist"
  ) {
    throw new Error("build must use npm run build and output dist");
  }

  const distribution = requireRecord(manifest.distribution, "distribution");
  if (typeof distribution.bundleFfmpegWasm !== "boolean") {
    throw new Error("bundleFfmpegWasm must be boolean");
  }
  if (typeof distribution.bundleRuntimeWasm !== "boolean") {
    throw new Error("bundleRuntimeWasm must be boolean");
  }
  if (distribution.bundleModels !== false) throw new Error("bundleModels must remain false");

  return {
    schemaVersion: 1,
    repository: auditedRepository,
    commit: manifest.commit,
    sourceDirectory: "vendor/ai-video-editor",
    license: "MIT",
    include,
    exclude,
    build: {
      packageManager: "npm",
      command: ["npm", "run", "build"],
      outputDirectory: "dist",
    },
    distribution: {
      bundleFfmpegWasm: distribution.bundleFfmpegWasm,
      bundleRuntimeWasm: distribution.bundleRuntimeWasm,
      bundleModels: false,
    },
  };
}

export async function readManifest(repoRoot: string): Promise<AiVideoEditorManifest> {
  const manifestPath = path.join(repoRoot, "vendor", "ai-video-editor.manifest.json");
  const source = await readFile(manifestPath, "utf8");
  return validateManifest(JSON.parse(source) as unknown);
}

export type SnapshotFile = {
  relativePath: string;
  absolutePath: string;
  size: number;
};

export type SnapshotDiff = {
  added: string[];
  modified: string[];
  removed: string[];
};

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error(`snapshot path must remain relative: ${value}`);
  }
  return normalized;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  if (process.platform === "win32") {
    const rootLower = normalizedRoot.toLowerCase();
    const candidateLower = normalizedCandidate.toLowerCase();
    return candidateLower === rootLower || candidateLower.startsWith(`${rootLower}${path.sep}`);
  }
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function isExcluded(relativePath: string, excludes: string[]): boolean {
  return excludes.some((excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`));
}

async function collectSnapshotFilesInternal(
  sourceRoot: string,
  manifest: AiVideoEditorManifest,
  requireIncludedRoots: boolean,
): Promise<SnapshotFile[]> {
  const resolvedRoot = path.resolve(sourceRoot);
  const excludes = manifest.exclude.map(normalizeRelativePath);
  const files = new Map<string, SnapshotFile>();

  async function walk(relativePath: string): Promise<void> {
    const normalized = normalizeRelativePath(relativePath);
    if (isExcluded(normalized, excludes)) return;
    const absolutePath = path.resolve(resolvedRoot, ...normalized.split("/"));
    if (!isInsideRoot(resolvedRoot, absolutePath)) {
      throw new Error(`snapshot path escapes source root: ${normalized}`);
    }

    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !requireIncludedRoots) return;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in the vendored snapshot: ${normalized}`);
    }
    if (metadata.isDirectory()) {
      const entries = await readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        await walk(`${normalized}/${entry.name}`);
      }
      return;
    }
    if (!metadata.isFile()) {
      throw new Error(`unsupported filesystem entry in vendored snapshot: ${normalized}`);
    }
    files.set(normalized, { relativePath: normalized, absolutePath, size: metadata.size });
  }

  for (const included of manifest.include) {
    const normalized = normalizeRelativePath(included);
    try {
      await walk(normalized);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`required upstream path is missing: ${normalized}`, { cause: error });
      }
      throw error;
    }
  }

  return [...files.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function collectSnapshotFiles(
  sourceRoot: string,
  manifest: AiVideoEditorManifest,
): Promise<SnapshotFile[]> {
  return collectSnapshotFilesInternal(sourceRoot, manifest, true);
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function diffSnapshots(
  sourceRoot: string,
  destinationRoot: string,
  manifest: AiVideoEditorManifest,
): Promise<SnapshotDiff> {
  const sourceFiles = await collectSnapshotFilesInternal(sourceRoot, manifest, true);
  const destinationFiles = await collectSnapshotFilesInternal(destinationRoot, manifest, false);
  const sourceByPath = new Map(sourceFiles.map((file) => [file.relativePath, file]));
  const destinationByPath = new Map(destinationFiles.map((file) => [file.relativePath, file]));
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [relativePath, sourceFile] of sourceByPath) {
    const destinationFile = destinationByPath.get(relativePath);
    if (!destinationFile) {
      added.push(relativePath);
      continue;
    }
    if (sourceFile.size !== destinationFile.size || (await sha256(sourceFile.absolutePath)) !== (await sha256(destinationFile.absolutePath))) {
      modified.push(relativePath);
    }
  }
  for (const relativePath of destinationByPath.keys()) {
    if (!sourceByPath.has(relativePath)) removed.push(relativePath);
  }

  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

export async function applySnapshot(
  sourceRoot: string,
  destinationRoot: string,
  manifest: AiVideoEditorManifest,
): Promise<{ copiedFiles: number; copiedBytes: number }> {
  const files = await collectSnapshotFiles(sourceRoot, manifest);
  const resolvedDestination = path.resolve(destinationRoot);
  const destinationParent = path.dirname(resolvedDestination);
  const suffix = randomUUID();
  const stagingRoot = `${resolvedDestination}.staging-${suffix}`;
  const backupRoot = `${resolvedDestination}.backup-${suffix}`;
  let destinationMoved = false;

  await mkdir(destinationParent, { recursive: true });
  try {
    for (const file of files) {
      const target = path.join(stagingRoot, ...file.relativePath.split("/"));
      if (!isInsideRoot(stagingRoot, target)) throw new Error(`snapshot destination escaped staging root: ${file.relativePath}`);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.absolutePath, target);
    }
    await collectSnapshotFiles(stagingRoot, manifest);
    const localProvenancePath = path.join(resolvedDestination, "UPSTREAM.md");
    try {
      const provenanceMetadata = await lstat(localProvenancePath);
      if (provenanceMetadata.isSymbolicLink() || !provenanceMetadata.isFile()) {
        throw new Error("vendor UPSTREAM.md must be a regular file");
      }
      await copyFile(localProvenancePath, path.join(stagingRoot, "UPSTREAM.md"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    try {
      await rename(resolvedDestination, backupRoot);
      destinationMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stagingRoot, resolvedDestination);
    if (destinationMoved) await rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    if (destinationMoved) {
      await rm(resolvedDestination, { recursive: true, force: true });
      await rename(backupRoot, resolvedDestination);
    }
    throw error;
  }

  return {
    copiedFiles: files.length,
    copiedBytes: files.reduce((total, file) => total + file.size, 0),
  };
}

export type BundleCategory = "javascript" | "css" | "wasm" | "media" | "other";

export type BundleMeasurement = {
  totalBytes: number;
  categories: Record<BundleCategory, number>;
  largestFiles: Array<{ relativePath: string; bytes: number }>;
};

const mediaExtensions = new Set([
  ".aac",
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mp3",
  ".mp4",
  ".ogg",
  ".png",
  ".svg",
  ".wav",
  ".webm",
  ".webp",
]);

function bundleCategory(relativePath: string): BundleCategory {
  const extension = path.extname(relativePath).toLowerCase();
  if ([".js", ".mjs", ".cjs"].includes(extension)) return "javascript";
  if (extension === ".css") return "css";
  if (extension === ".wasm") return "wasm";
  if (mediaExtensions.has(extension)) return "media";
  return "other";
}

export async function measureBundle(distRoot: string): Promise<BundleMeasurement> {
  const resolvedRoot = path.resolve(distRoot);
  const measuredFiles: Array<{ relativePath: string; bytes: number }> = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      const relativePath = path.relative(resolvedRoot, absolutePath).replaceAll("\\", "/");
      if (!isInsideRoot(resolvedRoot, absolutePath)) throw new Error(`bundle path escapes dist root: ${relativePath}`);
      if (metadata.isSymbolicLink()) throw new Error(`bundle must not contain symbolic links: ${relativePath}`);
      if (metadata.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`bundle contains unsupported filesystem entry: ${relativePath}`);
      measuredFiles.push({ relativePath, bytes: metadata.size });
    }
  }

  await walk(resolvedRoot);
  const categories: BundleMeasurement["categories"] = {
    javascript: 0,
    css: 0,
    wasm: 0,
    media: 0,
    other: 0,
  };
  for (const file of measuredFiles) categories[bundleCategory(file.relativePath)] += file.bytes;
  return {
    totalBytes: measuredFiles.reduce((total, file) => total + file.bytes, 0),
    categories,
    largestFiles: measuredFiles
      .sort((left, right) => right.bytes - left.bytes || left.relativePath.localeCompare(right.relativePath))
      .slice(0, 10),
  };
}

export async function assertBuildInputs(
  vendorRoot: string,
  manifest: AiVideoEditorManifest,
): Promise<void> {
  // FFmpeg.wasm (GPL) left the bundle; the editor converts with mediabunny.
  if (manifest.distribution.bundleFfmpegWasm || !manifest.distribution.bundleRuntimeWasm) {
    throw new Error("the editor build bundles its runtime WASM and no FFmpeg.wasm");
  }
  await collectSnapshotFiles(vendorRoot, manifest);
  const modelDirectory = path.join(vendorRoot, "public", "models");
  try {
    await lstat(modelDirectory);
    throw new Error("public/models must not be bundled; model weights are downloaded on demand");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function resolveNpmInvocation(
  nodeExecutable = process.execPath,
): Promise<{ executable: string; argsPrefix: string[] }> {
  const npmCliPath = path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
  try {
    const metadata = await lstat(npmCliPath);
    if (!metadata.isFile()) throw new Error(`npm CLI is not a regular file: ${npmCliPath}`);
    return { executable: nodeExecutable, argsPrefix: [npmCliPath] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (process.platform === "win32") {
      throw new Error(`unable to locate npm JavaScript CLI next to Node: ${npmCliPath}`, { cause: error });
    }
    return { executable: "npm", argsPrefix: [] };
  }
}

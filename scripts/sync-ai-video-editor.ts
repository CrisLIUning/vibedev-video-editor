import path from "node:path";

import { applySnapshot, diffSnapshots, readManifest } from "./ai-video-editor-vendor.ts";

type SyncArguments = {
  source: string;
  mode: "check" | "apply";
};

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/sync-ai-video-editor.ts --source <reviewed-directory> --check",
    "  node --import tsx scripts/sync-ai-video-editor.ts --source <reviewed-directory> --apply",
  ].join("\n");
}

function parseArguments(argv: string[]): SyncArguments {
  let source: string | undefined;
  let mode: SyncArguments["mode"] | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`--source requires a directory\n${usage()}`);
      source = value;
      index += 1;
      continue;
    }
    if (argument === "--check" || argument === "--apply") {
      const nextMode = argument.slice(2) as SyncArguments["mode"];
      if (mode) throw new Error(`choose exactly one of --check or --apply\n${usage()}`);
      mode = nextMode;
      continue;
    }
    throw new Error(`unknown argument: ${argument}\n${usage()}`);
  }
  if (!source || !mode) throw new Error(`--source and one mode are required\n${usage()}`);
  return { source: path.resolve(source), mode };
}

function hasDrift(diff: Awaited<ReturnType<typeof diffSnapshots>>): boolean {
  return diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const args = parseArguments(process.argv.slice(2));
  const manifest = await readManifest(repoRoot);
  const destinationRoot = path.resolve(repoRoot, ...manifest.sourceDirectory.split("/"));
  const expectedDestination = path.resolve(repoRoot, "vendor", "ai-video-editor");
  if (destinationRoot.toLowerCase() !== expectedDestination.toLowerCase()) {
    throw new Error(`refusing to sync outside the pinned vendor destination: ${destinationRoot}`);
  }

  const before = await diffSnapshots(args.source, destinationRoot, manifest);
  if (args.mode === "check") {
    if (!hasDrift(before)) {
      console.log("[ai-video-editor] vendored snapshot matches reviewed source");
      return;
    }
    console.error(JSON.stringify({ status: "drift", ...before }, null, 2));
    process.exitCode = 1;
    return;
  }

  const result = await applySnapshot(args.source, destinationRoot, manifest);
  const after = await diffSnapshots(args.source, destinationRoot, manifest);
  if (hasDrift(after)) throw new Error(`snapshot verification failed after apply: ${JSON.stringify(after)}`);
  console.log(
    JSON.stringify(
      {
        status: "applied",
        destination: manifest.sourceDirectory,
        copiedFiles: result.copiedFiles,
        copiedBytes: result.copiedBytes,
        previousDrift: before,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(`[ai-video-editor] sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});

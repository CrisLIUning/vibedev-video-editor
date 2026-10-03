# Timeline Studio MCP integration

The bundled MCP server is a local STDIO transport over Timeline Studio's existing Agent command runner. It does not implement timeline edits separately and does not require an OpenAI API key.

## Availability

The server requires a Timeline Studio repository checkout with installed Node dependencies and `scripts/timeline-command.mjs`. It resolves the repository from `TIMELINE_STUDIO_ROOT`, the process working directory, or its source location. A standalone Skill installation without the repository command layer must use the browser workflow or point `TIMELINE_STUDIO_ROOT` at a checkout.

Start it from the repository root with:

```bash
npm run mcp
```

The repository's `.codex/config.toml` registers it project-locally. For another local Codex project, configure a STDIO server whose command runs `npm run mcp --silent` in the Timeline Studio checkout, or set `TIMELINE_STUDIO_ROOT` explicitly.

## Tools

- `timeline_project_inspect`: read the project revision, tracks, media, and warnings.
- `timeline_track_inspect`: read one track and its clips.
- `timeline_clip_inspect`: read one clip's source mapping, properties, and links.
- `timeline_transcript_inspect`: read all serialized speech or one speech clip.
- `timeline_project_diff`: validate operations and return a field-level dry-run diff.
- `timeline_project_apply`: apply the same revision-checked operations and write a new `.timeline` archive.
- `timeline_project_render`: render the supported headless subset to a new MP4 and return decoded verification.

## Required write sequence

1. Call `timeline_project_inspect` and retain its revision.
2. Build operations with stable, unique IDs from [command-contract.md](command-contract.md).
3. Call `timeline_project_diff` with the current revision and complete operation list.
4. Review its warnings and changes. Stop on any failed precondition or unsupported operation.
5. Call `timeline_project_apply` with exactly the same project, revision, and operations, plus a new absolute output path.
6. Inspect the new archive before rendering or continuing.

Apply and render never overwrite an existing output through MCP. Choose a new output path for every attempt. The command transaction still enforces revision checks, operation idempotency, caption-to-speech constraints, and all project-aware validation.

`timeline_project_diff` is read-only. `timeline_project_apply` and `timeline_project_render` write only their declared output artifacts. The server does not download models, call remote services, open the editor, or mutate Codex's global configuration.

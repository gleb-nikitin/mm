# Handoff — mm_devops

Last updated 2026-04-18 after landing Gemini importer.

## Current state

- **Schema v7 live** (adds `import_state` for incremental session imports).
- **Claude Importer updated** with `--min-age-seconds` and `mtime` state tracking.
- **Codex Importer added** (`scripts/import-codex.ts`) for importing Codex sessions.
- **Gemini Importer added** (`scripts/import-gemini.ts`) for importing Gemini sessions.
- **Search refined**: `hybridSearch` now uses `buildFtsQuery` and `applyEventLane`.

## What this session changed

- **Added `scripts/import-gemini.ts`**:
  - Parity with Claude/Codex importers for `~/.gemini/tmp/<project>/chats/session-*.json` transcripts.
  - Defaults to `--min-turns 3`.
  - Strips `toolCalls` and `info` messages.

## Verification this session (all green)

- `bun run typecheck` green.
- Gemini importer verified against local data: successfully skips live/unchanged sessions and imports new ones.

## Next steps

1. Follow `agent/docs/todo.md` step 1 — **tests**.
2. Once tests provide a safety net, proceed to step 2 (readability pass on `src/brain.ts`).

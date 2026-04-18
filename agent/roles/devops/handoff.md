# Handoff — mm_devops

Last updated 2026-04-18 after landing raw_events FTS and importer rewrite.

## Current state

- **Schema v6 live** (adds `raw_events.title` and `events_fts` virtual table).
- **Claude Importer rewritten** to target `raw_events` and `events_fts` directly.
- **Search always uses hybridSearch** (removed wiki-only fallback), making events immediately findable.
- **Dual-Root Raw Architecture** (MD + SQLite) is now being actively used for high-volume streaming data.

## What this session changed

- **Implemented `events_fts`** in `src/core.ts` for fast retrieval of raw events.
- **Rewrote `scripts/import-claude.ts`**:
  - Ingests into `raw_events` and `events_fts` instead of `raw/` files.
  - Flattens session transcripts, removing noise (`tool_use`).
  - Added `--projects-dir` flag for testing.
- **Simplified search path** in `src/brain.ts` to always use `hybridSearch`.

## Verification this session (all green)

- `bun run typecheck` green.
- `initDb()` migrates to v6 correctly.
- Dry-run of new `import-claude.ts` verified target paths and session flattening.

## Next steps

1. Follow `agent/docs/todo.md` step 1 — **tests**.
2. Once tests provide a safety net, proceed to step 2 (readability pass on `src/brain.ts`).

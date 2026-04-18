# Handoff — mm_devops

Last updated 2026-04-18 after establishing behavioral tests and event provenance.

## Current state

- **Schema v9 live** (adds `claim_sources_event` for clean FK integrity between claims and events).
- **Behavioral Tests established** (`tests/behavior.test.ts`). Run with `bun test`.
- **`brain process` (v0.9.0)**: Supports dual retro-sweep (raw files + events).
- **`brain ingest-event`**: Targeted CLI tool for processing specific LLM sessions.
- **API**: Now honors `MT_PORT`.

## What this session changed

- **Refactor**: Lifted multi-signal provenance helpers (`snapshotWiki`, `detectWikiChanges`, `timelineCitesRaw`, `timelineCitesEvent`, `backfillClaimsFromTimeline*`) into `src/core.ts` for reuse by tests and other surfaces.
- **Testing**: Implemented a comprehensive behavioral test suite that exercises:
  - Fresh-root bootstrap to latest schema.
  - Phase 1 retro-sweep for both files and events.
  - Negative paths (failing LLM synthesis).
  - Search result ranking (event lane).
  - API `/active` endpoint shape.
  - Importer deduplication logic.
- **Core**: Added `refreshSourceCount(slug)` to ensure `source_count` correctly sums both entries and events.

## Verification this session (all green)

- `bun run typecheck` green.
- `bun test` passes all suites.
- Schema v9 migration verified correctly.

## Next steps

1. Follow `agent/docs/todo.md` step 2 (readability pass on `src/brain.ts`). Now safe to refactor thanks to the behavioral test suite.
2. Wire up ac-chain importer once the schema proves out.

# Handoff — mm_devops

Last updated 2026-04-17 after landing source-separation.

## Current state

- Structural cleanup + `src/` move are committed (`c210c1e`).
- A `git` role was added (`61e284e`) — devops does not own that role.
- **UI + async-gemini work is committed** (`ed3eaf2`).
- **Claude Code sessions import script + macOS commands are committed** (`dd9bba4`).
- **Source-separation landed** (`7b5f0ef`): schema v4, recursive raw/ indexing, filtered search/query by source_type and project.
- **Two-track plan (Light + Hardcore) defined** in `agent/docs/roadmap.md`.

## What this session changed

- (See previous handoffs for earlier work)
- Implemented **Source-separation**:
  - `meta/schema.md` defines the source_type/project taxonomy.
  - `src/core.ts` handles schema v4 migration and filtered `hybridSearch`.
  - `src/api.ts` and `src/mcp.ts` expose filters to external surfaces.
  - `scripts/import-claude.ts` now uses correct directory layout and tags.
- Added `agent/docs/how-to-import.md`.

## Verification this session (all green)

- All changes verified end-to-end.
- Filtered retrieval verified: `?source=raw` excludes wiki pages.
- Claude import verified: dry-run shows correct target paths.
- Repository is clean (except for handoff files).

## Next steps

1. Follow `agent/docs/todo.md` step 1 — **tests**.
2. Once tests provide a safety net, proceed to step 2 (readability pass on `src/brain.ts`).

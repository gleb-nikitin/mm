# Handoff — mm_git

## Current State
- **Schema v7 landed** (`import_state` table for incremental session imports).
- **Claude Importer updated** with incremental support and "live" session detection.
- **Codex Importer added** (`scripts/import-codex.ts`) for importing Codex sessions.
- **Search refined**: `hybridSearch` now uses a sanitized FTS query builder and a dedicated "event lane" to ensure event results aren't crowded out by wiki pages.
- **Milestone Log (`wiki/Milestones.md`) automated**.

## Tasks
- [x] Land Schema v7 and `import_state` logic.
- [x] Update Claude importer with incremental support.
- [x] Add Codex session importer.
- [x] Refine FTS query building and result ranking (event lane).

## Blockers
- None.

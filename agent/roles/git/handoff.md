# Handoff — mm_git

## Current State
- **Schema v6 landed** (`raw_events.title` + `events_fts` virtual table).
- **Claude Importer rewritten** (`scripts/import-claude.ts`) to target `raw_events` instead of `raw/` files.
- **Search unified**: `brain search` now always uses `hybridSearch` and includes events.
- **Dual-Root Raw Architecture** (MD + SQLite) is now live via `raw_events`.
- **Milestone Log (`wiki/Milestones.md`) automated**.

## Tasks
- [x] Land Schema v6 and `events_fts` integration.
- [x] Rewrite Claude importer to use `raw_events`.
- [x] Unify search path in `brain.ts`.

## Blockers
- None.

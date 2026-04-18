# Handoff — mm_git

## Current State
- **Behavioral Test Suite established** (`tests/behavior.test.ts`).
- **Schema v9 landed** (`claim_sources_event` table for event-based provenance).
- **`process` command refactored (v0.9.0)**:
  - Unified retro-sweep for both `raw_entries` and `raw_events`.
  - Added `ingest-event` command for targeted single-event ingestion.
- **Core refactored**: Multi-signal provenance helpers (`snapshotWiki`, `detectWikiChanges`, etc.) moved from `brain.ts` to `core.ts`.
- **API improved**: `MT_PORT` environment variable support.
- **Milestone Log (`wiki/Milestones.md`) automated**.

## Tasks
- [x] Establish behavioral test suite (`bun test`).
- [x] Implement event-based provenance (Schema v9 + `claim_sources_event`).
- [x] Refactor `process` to v0.9.0 with dual retro-sweep.
- [x] Add `ingest-event` CLI command.
- [x] Move core helpers from `brain.ts` to `core.ts`.
- [x] Support `MT_PORT` in `api.ts`.

## Blockers
- None.

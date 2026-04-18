# Handoff — mm_devops

Last updated 2026-04-18 after landing Schema v5 and Dual-Root Raw architecture.

## Current state

- **Schema v5 landed** (added `raw_events` table for streaming chats/chains).
- **Dual-Root Raw Architecture** (MD + SQLite) defined in `todo.md`.
- **Tiered Compute Philosophy** (Simple/Stupid/Serious) documented forLib vs Processor split.
- Role Briefings established for `devops` and `git` for faster context loading.

## What this session changed

- (See roadmap for earlier work)
- **Implemented `raw_events` in `src/core.ts`**.
- Refined `agent/docs/todo.md` with detailed architecture and metadata hygiene rules.
- Added `meta/skills/summarize-event.md` for low-latency pre-processing.

## Verification this session (all green)

- `bun run typecheck` green.
- `initDb()` migrates to v5 correctly.
- All docs verified.

## Next steps

1. Follow `agent/docs/todo.md` step 1 — **tests**.
2. Once tests provide a safety net, proceed to step 2 (readability pass on `src/brain.ts`).

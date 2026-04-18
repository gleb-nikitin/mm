# Handoff — mm_devops

Last updated 2026-04-18 after the `process` command refactor.

## Current state

- **Schema v5 landed** (added `raw_events` table for streaming chats/chains).
- **Dual-Root Raw Architecture** (MD + SQLite) defined in `todo.md`.
- **`process` command refactored to version 0.7.3**.
- **Tiered Compute Philosophy** documented.

## What this session changed

- **Refactored `src/brain.ts` `process` command**: 
    - Phase 1: Deterministic retro-sweep for timeline citations.
    - Phase 2: LLM loop with dual-signal provenance (CLI or timeline).
    - Added backfill mechanism from timeline to `claim_sources`.
- **Gemini prompt updated** for clearer ingest rules.

## Verification this session (all green)

- `bun run typecheck` green.
- Manual test on a timeline citation confirmed retro-sweep works.

## Next steps

1. Follow `agent/docs/todo.md` step 1 — **tests**.
2. Once tests provide a safety net, proceed to step 2 (readability pass on `src/brain.ts`).

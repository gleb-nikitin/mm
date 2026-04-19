# Handoff: mm_lib

## Current State
- **Wiki**: 30+ pages total.
- **Queue**: Empty. All 35 items (7 sessions from 2026-04-17/18) processed.
- **Architecture**: Dual-Root Raw (Docs/Events) and Tiered Compute Philosophy codified.
- **Importers**: Claude, Codex, and Gemini importers all land in `raw_events` and `events_fts`. Incremental imports using `import_state` (Schema v7) and 300s "settled" check.
- **Search**: `hybridSearch` (RRF) with a 30% reserved event lane and bag-of-words FTS normalization.
- **UI**: Standalone "Active Agents" dashboard (`ui/active.html`) with Holo UI glass aesthetic.
- **Indexing**: `v0.7.3` logic with Phase 1 retro-sweep (deterministic provenance backfill).
- **Automation**: `process-new.command` (v2) sequential pipeline.

## Blockers
- None.

## Next Steps
1. **Tiered Compute Philosophy**: Automate metric derivation (source_count, mentions) to reduce manual metadata maintenance.
2. **Derivation-Skill family**: Start with `derive-bugs` or `derive-decisions` to automate artifact creation from session logs.
3. **Port `process-new.command` logic** into a production-ready `scheduler.ts` using `meta/config.toml`.
4. **Observer Mode**: Implement to eliminate manual `index rebuild` calls.
5. **Testing**: Implement behavioral tests and eval harness (Step 1 of roadmap).

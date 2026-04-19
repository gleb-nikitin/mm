# Handoff: mm_lib

## Current State
- **Wiki**: 16 pages total.
- **Events**: All 4 mm-events from 2026-04-18 (0acb5c2b, ea79e001, 28035305, 12d68fba) processed.
- **Queue**: Empty (Both files and mm-events).
- **Milestones**: `wiki/Milestones.md` is now the source of truth for repository evolution.
- **Architecture**: Dual-Root Raw (Docs/Events) and Tiered Compute Philosophy codified in `todo.md`.

## Blockers
- **CLI Friction**: Argument vs Option confusion in `brain page create`.
- **Sync Friction**: Still need "Observer Mode" for automatic index rebuilding.

## Next Steps
1. Implement the **Tiered Compute Philosophy**: Automate metric derivation (source_count, mentions) to reduce manual metadata maintenance.
2. Build the **Derivation-Skill family**: Start with `derive-bugs` or `derive-decisions` to automate artifact creation from session logs.
3. Port `process-new.command` logic into a production-ready `scheduler.ts` using `meta/config.toml`.
4. Implement **Observer Mode** to eliminate manual `index rebuild` calls.

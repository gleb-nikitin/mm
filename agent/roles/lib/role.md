# Role: mm_lib

## Scope
- **Extraction**: Read raw chunks, extract signal into 9 wiki buckets per `meta/skills/ingest.md`. This is the primary job.
- **Maintenance**: Fix stale entries, broken references, wrong claims on sight. Run `brain lint` / `brain doctor` when the queue is clear.
- **Self-evolution**: Update `briefing.md`, `soul.md`, `soul-interactive.md`, `changes.md` when you find a better way to work. Propose larger changes in `changes.md`.
- **Self-automation**: Write scripts to `agent/roles/lib/scripts/` for recurring friction. Document in `briefing.md`.

## Stop Rules
- **Context saturation (~80%)**: Stop, write `handoff.md`, `touch meta/RELAUNCH_NEEDED`.
- **DB drift**: If filesystem and DB are out of sync, run `brain index rebuild` before processing.

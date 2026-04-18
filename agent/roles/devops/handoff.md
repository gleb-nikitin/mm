# Handoff — mm_devops

Last updated 2026-04-18 after the Option A provenance fix (commit 08b3c5a) and a docs-hygiene pass.

## Current state

- **Schema v5** live; `raw_events` table in place for streaming chats/chains (no importers wired yet — still dead furniture).
- **Dual-Root Raw Architecture** (MD for `raw/docs/…` + SQLite for events) defined.
- **Ingest loop self-heals.** `brain process` v0.7.3 accepts Timeline citations as sufficient provenance (Option A). Phase 1 retro-sweep runs before any LLM call; Phase 2 accepts either `claim_sources` growth OR a modified wiki timeline citing the raw path. Prompt updated to match the ingest skill.
- **Docs cleaned.** Canonical owners — reading order: `agent/README.md`; operator manual: `how-mm-works.md`; direction + priority: `agent/docs/roadmap.md`; brainstorm ideas: `agent/docs/todo.md`; data model: `meta/schema.md`. Duplicated sequence/architecture blocks removed.

## What this session changed

- `src/brain.ts` (commit 08b3c5a): `snapshotWiki`, `detectWikiChanges`, `timelineCitesRaw`, `backfillClaimsFromTimeline`; two-phase `process` rewrite; version → 0.7.3.
- `agent/README.md`: corrected `todo.md` description (brainstorm aggregation, not "deferred work in dependency order"); added `how-mm-works.md` to the reading order.
- `agent/docs/roadmap.md`: dropped duplicated "Read order" + "Architecture (Light)"; points to canonical owners.
- `agent/docs/todo.md`: dropped duplicated "Sequence" + "What mm actually is"; added brainstorm-aggregation header.
- `how-mm-works.md`: Section 5 (Wiki Anatomy) and Section 7 (Feature Plans) collapsed to pointers.

## Verification this session (all green)

- `bun run typecheck` green.
- Fresh-root bootstrap green.
- Phase 1 integration test: cited raw → retro-linked, claim + claim_source + source_count + ops_log all correct.
- Phase 1 negative path: uncited raw with failing Gemini stays `processed=0`.
- Real-repo queue unchanged (2 stuck entries; neither timeline-cited yet — need a real ingest pass).

## Next steps

Three natural candidates, pick one per session:

1. **Drive a live `brain process` run** on the 2 stuck entries to confirm Phase 2 works end-to-end with real Gemini. Cheapest validation of the fix.
2. **Wire the first `raw_events` importer** (chain importer is the smallest useful target) so schema v5 stops being dead furniture.
3. **Replace `process-new.command`** with a minimal declarative scheduler — first cut at `meta/config.toml` per the todo.md brainstorm.

Roadmap step 1 (tests) stays the canonical next-big-thing once we pick a target for ongoing test surface.

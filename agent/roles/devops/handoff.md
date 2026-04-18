# Handoff — mm_devops

Last updated 2026-04-18 after targeted event ingestion + behavior test suite + schema v9. End of a long session that took mm from "importer shipped" to "full search → pick → ingest loop" across three LLM-chat providers.

## Current state

- **Schema v9.** `claim_sources_event` (parallel to `claim_sources`) lets events be cited in wiki timelines with the same Option A semantics as file-backed raws. Migrated in-place from v5 through every commit this session.
- **Ingestion loop complete end-to-end.** Search → pick `external_id` → `brain ingest-event <id>` → wiki synthesis with `event:<id>` timeline citation → `claim_sources_event` + `processed=1`. `brain process` Phase 1 retro-sweep handles both raws and events.
- **Three LLM-chat importers** (Claude / Codex / Gemini) land sessions in `raw_events` + `events_fts`. Incremental (mtime-based) with settled-session boundary (5 min). `import_state` is the full sightings log feeding the dashboard.
- **Live-agent dashboard.** `list_active_agents` (MCP) + `GET /active` (markdown) + standalone `/active-ui` (Alpine). DB-only, zero filesystem reads at dashboard time. Keyed on `last_mtime`. Snippet is the most recent text-bearing turn of either role.
- **Behavior test suite.** 7 tests under `bun test` covering schema migration, Option A retro-sweep (raw + event, positive + negative), hybridSearch event lane, `/active` markdown shape, importer dedup.
- **`MT_PORT`** env var in `api.ts` so the test API doesn't collide with a running real API on :3000.

## What this session changed (chronological)

1. Option A provenance fix (`08b3c5a`) — Timeline citations treated as sufficient provenance; Phase 1 retro-sweep introduced.
2. Docs hygiene pass (`3baf333`) — canonical ownership for reading order, roadmap, brainstorm, operator manual.
3. Claude importer → `raw_events` + `events_fts` (`1798e3e`) — schema v6, clean parse, `INSERT OR IGNORE` dedup.
4. Codex importer, search ranking fix, event reserved lane (`10dc5d6`).
5. Incremental import + settled-session (`93a40c9`) — schema v7 `import_state` table.
6. Gemini importer + active-agents dashboard — schema v8 (`import_state` metadata columns), MCP tool, standalone UI, `last_mtime` filter, snippet fixes.
7. Targeted event ingestion + behavior tests (`5b2bcb6`) — schema v9, `brain ingest-event`, helpers moved to `core.ts`, `bun test` suite.

Provenance helpers (`snapshotWiki`, `detectWikiChanges`, `timelineCitesRaw`, `backfillClaimsFromTimeline`, plus new `timelineCitesEvent`, `backfillClaimsFromTimelineEvent`, unified `refreshSourceCount`) now live in `src/core.ts` — earns down roadmap step 3b.

## Verification (all green)

- `bun run typecheck` ✓
- `bun run test` → 7 pass / 0 fail / 38 expect() calls
- Fresh-root bootstrap → schema v9
- Dashboard live at `/active-ui`; events surfacing in search via reserved lane.
- Real-repo live: all three importers populating, dashboard reflecting activity within 30s of a new turn.

## Known limitation (observed this session)

Search skews wiki-heavy because events have FTS only (no vector). The reserved-lane workaround guarantees event visibility in the top-N but not ranked salience. User flagged after running real queries; fix is the natural next scope.

## Next steps — three candidates, pick one per session

1. **Vector pass over `raw_events`** — directly addresses the wiki-skew the user just noticed. Extend `embedBrain()` to chunk + embed event content alongside wiki pages. Retires the reserved-lane hack; ranking becomes real. Smallest of the three.
2. **Briefing protocol** (roadmap 4c) — biggest single UX lever. Reuse a synthesis session across calls instead of re-sending skill+schema preamble every time. Cuts `/query` latency ~5–10× and is a prereq for streaming to feel fast. ac/ has reference code worth lifting.
3. **Skills-library expansion** (roadmap 2b–2f) — `derive-bugs`, `derive-decisions`, `derive-corrections`, `derive-friction`. Infrastructure is ready; this is content extending mm's action layer, not plumbing.

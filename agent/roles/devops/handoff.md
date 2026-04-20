# Handoff — mm_devops

Wish I knew on cold start. Current sharp edges only.
Rewrite target: 50 lines. If it grows, compress; do not append.
Not a changelog. Not a backlog. Not history. Use git for what changed; use chains for why.

## Incoming note from prior devops

- You're walking into a project where the user runs audits on your work (Codex, via `agent/roles/audit/`). Expect scrutiny on invariants, not just happy paths — every writer should be transactional + keep FTS in sync. v11.1 and v11.2 were both audit rounds; plan for round 3 if you touch ingestion or artifact paths.
- **Read the "Deferred" section below before picking next work.** The "rip v10 paths vs maintain" meta-decision is the single most consequential call — `brain add`/`raw_entries`/`brain index rebuild`/`wiki_pages`/`claims`/`/query` all still compile but have known bugs and no v11 consumers. Fixing them treats them as supported.
- Test suite has a **pre-existing ~20% flake rate** on `/active markdown shape` and `chunk-events` tests. Reproduced before any of my changes. Don't chase — budget for a real test-isolation pass if CI lands.
- Chains are about to be activated by the user. New input lanes means new things to upsert idempotently. Mirror the `upsertRawEvent` pattern (content_hash + transaction + FTS-sync).
- MCP server holds stdio state; any schema or tool change needs a full Claude Code restart, not just a `bun run mcp` relaunch.

## Wish I knew (v11 + v11.2 audit round — 2026-04-20)

**Schema is v11 + additive `raw_events.content_hash`.** `initDb` adds the column; no version bump. Purpose: fix silent data loss on session growth — importers now UPSERT via shared `upsertRawEvent` helper in core.

**`upsertRawEvent` is transactional (v11.2).** Body is wrapped in `db.transaction`. On hash change it UPDATEs content, title, timestamp, metadata, **project, source_type**, resets `chunked=0` AND `processed=0`, deletes `chunks_virtual` for that event, and rewrites `events_fts`. FTS failures now bubble up and roll the whole thing back — the earlier catch `{}` swallows are gone. `artifact_sources` is preserved (append-growth pattern keeps spans valid).

**API binds `127.0.0.1` by default.** `MT_BIND=0.0.0.0` overrides with a startup warning. `/raw-ui`, `/chunk/:id`, `/artifact/:id`, `/active` all leak raw transcripts — never expose without a real reason.

**Artifact FTS is a first-class surface.** CLI `brain artifact search <query>`, HTTP `/artifacts-search`, MCP `search_artifacts`. Tokenizes + ANDs + escapes fts5 operators. Use `list/keys` for browse, `search` for "find decisions mentioning X".

**Artifact dedup is core-side.** `brain artifact batch` upserts by `(project, type, idempotency_key)`. Librarian doesn't round-trip; the "Known Artifacts" block injected by `process-new.command` is the primary dedup signal.

**`chunks_virtual` offsets are into raw `raw_events.content`, NOT filtered output.** `filter_version` stamped on insert. `brain chunk read` slices raw + reapplies `filterMechanical` at current `FILTER_VERSION`. Bump `FILTER_VERSION` in `src/narrative.ts` when filter semantics change.

**`upsertArtifact` and `upsertRawEvent` are transactional.** FK failures roll back cleanly.

**`brain backup` uses WAL checkpoint + VACUUM INTO, not `cp`.** Safe on hot DB.

**MCP holds DB connection open.** Any schema change or DB swap needs a full Claude Code restart — `bun run mcp` alone doesn't reset stdio state.

**Legacy files stay.** Don't delete `wiki/<project>/*.md` or `raw/events/<project>/*.md` in v11 unless user asks. Chunker no longer writes to disk.

## Deferred — next devops call

**Rip v10 surfaces (decided 2026-04-20, audit-revised).** v11 pipeline calls none of the v10 surface. Scope, in order:

1. **Migrate `artifact_sources`**: drop `source_raw_id` column + FK + index via table-rebuild (SQLite won't DROP a FK in place). Update `ArtifactSource` type, `insertSources` call sites, `/artifact/:id` raw branch (`api.ts:264-268`). Must land before `raw_entries` DROP or fresh init breaks.
2. **Migrate `chunks.raw_id`**: orphaned legacy column, no v11 writer. Drop via same table-rebuild pattern.
3. **Rip surface**:
   - CLI: `brain add`, `brain save`, `brain query`, `brain queue`, `brain mark-processed`, `brain ingest-event` (explicit v10 per `lib/soul-interactive.md:41`)
   - HTTP: `/query`, `/add`, `/raw-ui` + `/raw*` dumps, update `renderRawDump`
   - MCP: `query_brain`, `add_to_brain`
   - Core: `queryBrain`, `addToBrain`, `raw_entries` table + indices, `claim_sources` join
   - Scripts: `scripts/ingest-manual.ts`, `scripts/import-chats.ts`
   - `internalRebuildIndex`: split — drop `raw_entries` half, keep wiki half, rename. Update all 8 callsites in `brain.ts` (includes `dream`, `page create`).
   - `meta/timeline.md`: rewrite off `raw_events` or drop.
4. **UI**: strip synthesis panel from `ui/index.html` (the `/query` caller at :345). Keep `/search`, `/wiki/`.
5. **Tests**: `tests/behavior.test.ts` has ~10 v10 assertions (`raw_entries`, `claim_sources`, `brain process`, `index rebuild` Phase-1 retro-sweep at `:109,:151-157,:176`). Migrate or delete — don't leave red suite.
6. **Pre-DROP safety**: SQL-dump `claim_sources` for provenance archive before `DROP TABLE`.

Moots round-1 audit items: `brain add` FTS invisibility, `brain index rebuild` processed-flip, `/query` ignores events.

**Real v11 bugs to keep:**
- `wiki_pages.source_count` drift — frontmatter overwrites the `claim_sources_event` recompute. Fix: make `source_count` derived-only (stop storing in frontmatter), or always run recompute after wiki sync.
- `import_state.last_mtime` advances before `upsertRawEvent` runs — a failed write checkpoints the file anyway. Fix: split live-agent-freshness vs import-checkpoint semantics.

**Unrelated infra:**
- ~20% flake on `/active markdown shape` + `chunk-events` tests. Budget a real test-isolation pass when CI lands.

## Typecheck + `bun test` are the gates. The project has no CI.

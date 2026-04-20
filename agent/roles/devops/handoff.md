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

**From audit round 1 (v10-surface bugs):**
- `brain add` / `raw_entries` is invisible to search (no FTS index, not embedded).
- `brain index rebuild` flips `processed=1→0` because `addToBrain` and `internalRebuildIndex` compute hash over different payloads.
- `wiki_pages.source_count` drift after rebuild (frontmatter overwrites authoritative count from `claims`).
- `/query` ignores event evidence — `queryBrain` only uses wiki+raw, not events.

**From audit round 2 (on the audit fix itself):**
- `import_state.last_mtime` is advanced BEFORE `upsertRawEvent` runs, so a failed write still checkpoints the file and next run skips it. Fixing requires splitting the column into live-agent-freshness vs import-checkpoint semantics (additive schema column or separate UPDATE paths). Not v11.2 scope — the tx wrap on `upsertRawEvent` already prevents half-written rows. Worth doing before the next importer rewrite.
- Test suite has a pre-existing ~20% flake rate on `/active markdown shape` and `chunk-events` tests (pre-dates v11.2 changes). Unrelated to correctness but noisy. Worth hunting if CI lands.

**Meta-call**: rip v10 paths entirely, or maintain both? Fix-as-bug treats them as supported; rip resolves correctness. v12 briefing protocol replaces `/query` either way.

## Typecheck + `bun test` are the gates. The project has no CI.

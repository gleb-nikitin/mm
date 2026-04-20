# Handoff — mm_devops

Wish I knew on cold start. Current sharp edges only.
Rewrite target: 50 lines. If it grows, compress; do not append.
Not a changelog. Not a backlog. Not history. Use git for what changed; use chains for why.

## Wish I knew (v11 + audit — 2026-04-20)

**Schema is v11 + additive `raw_events.content_hash`.** `initDb` adds the column; no version bump. Purpose: fix silent data loss on session growth — importers now UPSERT via shared `upsertRawEvent` helper in core. On hash change, content is updated, `chunks_virtual` for that event is dropped, `chunked` resets. `artifact_sources` is preserved (spans remain valid for append-growth, which is the vendor pattern).

**API binds `127.0.0.1` by default.** `MT_BIND=0.0.0.0` overrides with a startup warning. `/raw-ui`, `/chunk/:id`, `/artifact/:id`, `/active` all leak raw transcripts — never expose without a real reason.

**Artifact FTS is a first-class surface.** CLI `brain artifact search <query>`, HTTP `/artifacts-search`, MCP `search_artifacts`. Tokenizes + ANDs + escapes fts5 operators. Use `list/keys` for browse, `search` for "find decisions mentioning X".

**Artifact dedup is core-side.** `brain artifact batch` upserts by `(project, type, idempotency_key)`. Librarian doesn't round-trip; the "Known Artifacts" block injected by `process-new.command` is the primary dedup signal.

**`chunks_virtual` offsets are into raw `raw_events.content`, NOT filtered output.** `filter_version` stamped on insert. `brain chunk read` slices raw + reapplies `filterMechanical` at current `FILTER_VERSION`. Bump `FILTER_VERSION` in `src/narrative.ts` when filter semantics change.

**`upsertArtifact` and `upsertRawEvent` are transactional.** FK failures roll back cleanly.

**`brain backup` uses WAL checkpoint + VACUUM INTO, not `cp`.** Safe on hot DB.

**MCP holds DB connection open.** Any schema change or DB swap needs a full Claude Code restart — `bun run mcp` alone doesn't reset stdio state.

**Legacy files stay.** Don't delete `wiki/<project>/*.md` or `raw/events/<project>/*.md` in v11 unless user asks. Chunker no longer writes to disk.

## Deferred — next devops call

Codex audit (2026-04-20) flagged 4 v10-era bugs. All live in the code surface v11 hasn't ripped out yet:

- `brain add` / `raw_entries` is invisible to search (no FTS index, not embedded).
- `brain index rebuild` flips `processed=1→0` because `addToBrain` and `internalRebuildIndex` compute hash over different payloads.
- `wiki_pages.source_count` drift after rebuild (frontmatter overwrites authoritative count from `claims`).
- `/query` ignores event evidence — `queryBrain` only uses wiki+raw, not events.

**Meta-call**: rip v10 paths entirely, or maintain both? Fix-as-bug treats them as supported; rip resolves correctness. v12 briefing protocol replaces `/query` either way.

## Typecheck + `bun test` are the gates. The project has no CI.

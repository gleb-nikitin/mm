# Handoff — mm_devops

## Wish I knew (v11 — 2026-04-20)

**Schema is at v11.** Adds `artifacts`, `artifact_sources`, `artifacts_fts`, `chunks_virtual`. Bump 10 → 11 is add-only; no existing tables touched.

**Artifacts dedup is core-side, not skill-side.** `brain artifact batch` upserts by `(project, type, idempotency_key)`. Unique index enforces this. The librarian computes the key — `<type>:<project>:<slug-of-core-field>`. Re-running the same chunk must produce the same keys.

**`upsertArtifact` is transactional.** FK failures (e.g. invalid `source_event_id`) roll back cleanly — no orphan artifacts. Same for `batchArtifacts`. If you see an orphan, something rode around the transaction.

**`chunks_virtual` offsets are into raw `raw_events.content`, NOT filtered output.** `filter_version` is stamped on insert. `brain chunk read` slices raw and re-applies `filterMechanical()` at current `FILTER_VERSION`. If the filter changes behavior, bump `FILTER_VERSION` in `src/narrative.ts`; old chunks still read correctly at the new filter version because the source-of-truth is the raw slice.

**`brain backup` uses WAL checkpoint + VACUUM INTO, not `cp`.** Safe on a hot DB. `cp meta/brain.db meta/brain.db.bk` on an open WAL is a data-loss trap and is retired. Use `bun run brain backup --target <path>`.

**The MCP server still holds the DB connection open.** After `reset-brain.command` or DB swap, the MCP process still has a stale file descriptor. Only a full Claude Code restart re-spawns `bun src/mcp.ts` against the fresh DB. Same hazard as v10.

**v11 migration step for existing events:** to re-chunk old `raw_events` rows into `chunks_virtual`, run `UPDATE raw_events SET chunked=0 WHERE project='<p>'` then `bun scripts/chunk-events.ts --project <p>`. Old `raw/events/<p>/*.md` files are kept as read-only legacy — chunker no longer writes them (A1).

**Don't delete `wiki/<project>/*.md` or `raw/events/<project>/*.md` in v11.** They're read-only legacy. Deletion is a separate pass after v12 retrieval is proven.

**`scripts/import-code.ts` is deferred to v11.1.** Don't add it to `process-new.command` yet.

**Legacy gotchas still apply.** Wiki slugs are project-scoped subpaths (`wiki/mm/Arch_Decisions.md` → `mm/Arch_Decisions`). `brain queue` needs `--project mm` (no default). Ollama must be running for vector search (`curl http://localhost:11434/api/tags`, model `nomic-embed-text`). `DAYS=365 ./process-new.command` for a full historical re-ingest.

**Typecheck + `bun test` are the gates.** Always run both after touching `src/`, `scripts/`, or `tests/`. The project has no CI.

# Devops Handoff

Current task: `zcy`, shipped as three ordered commits. Part (a) is `61b21c9`; part (b) is `9b2b68f`; part (c) is implemented and awaiting audit.

Production after part (b):
- `meta/brain.db` is v16; integrity check passed. Notes remain 94, title hashes/FTS rows remain 205.
- Backup: `/Users/glebnikitin/Library/Application Support/com.aurora.core/data/backups/mm-brain-pre-note-provenance-repair-20260925T0355Z.db`.
- Repair resolved 88 notes (84 same-offset, 4 relocated); verification found 88 valid, 0 stale/missing, and unresolved IDs 48, 57, 78–81.
- API and watcher are healthy on committed code.
- Isolation correction: part (c) was briefly parsed by watcher child importers while it was mistakenly edited in the main checkout. It changes retrieval only, not importer/init write paths. The six-path diff now exists only in `/Users/glebnikitin/work/code/mm-zcy-c`; main was restored to `9b2b68f` before the healthy watcher was restarted.

Part (c) behavior:
- `hybridSearch()` fuses notes as one document per note ID across independent FTS and embedding RRF arms.
- `source=note` selects notes; project filters apply to notes. Other explicit source filters exclude them.
- Note results expose project, note ID, event ID, raw span, and verified provenance status. Search/query/validation cite `event:<id>` only for a matching span hash and label stale/missing/unresolved provenance.
- Query synthesis uses note FTS even if no chunk embeddings exist; `brain embed`'s existing note embeddings now affect retrieval.

Audit/commit scope for `zcy(c)` only:
- `README.md`
- `src/api.ts`
- `src/core.ts`
- `src/mcp.ts`
- `tests/behavior.test.ts`
- `agent/roles/devops/handoff.md`

Verification:
- Focused note RRF test: 1 pass, 0 fail, 10 expectations.
- Full `bun test`: 164 pass, 0 fail, 828 expectations.
- `bun run typecheck` and `git diff --check`: passed.

After audit + git: restart production API, smoke-search a known note, verify watcher/API health, then send final `DONE` to CTO. Exclude every other dirty path.

# Devops Handoff

Current task: `zcy`, shipped as three ordered commits. Part (a), notes FTS initialization, passed audit at `zcy-7` and is included in HEAD.

Part (a) behavior:
- `initDb()` records named migrations in `schema_migrations` while leaving schema version 15 available for the approved v16 provenance work.
- Existing databases rebuild `notes_fts` once under an immediate transaction; concurrent readers see the complete old or new index.
- Fresh databases and a stale-FK repair invalidate the marker and populate the recreated FTS table once.
- Later `initDb()` calls do not delete or reinsert FTS rows.
- A failed rebuild rolls back both the delete and partial inserts and leaves the migration unapplied for retry.
- Normal note creation continues to maintain its own FTS rows transactionally.

Audit/commit scope for `zcy(a)` only:
- `src/core.ts`
- `tests/behavior.test.ts`
- `agent/roles/devops/handoff.md`

Verification:
- Focused schema migration tests: 4 pass, 0 fail, 77 expectations.
- Full `bun test`: 154 pass, 0 fail, 747 expectations.
- `bun run typecheck`: passed.
- `git diff --check`: passed.

Next after commit:
- Reload production onto the committed code and verify the migration remains a no-op. The running watcher already loaded the dirty tree before audit and applied the marker at 2026-09-25 03:46:40 UTC; production has 94 notes, 205 valid artifacts, 205 `notes_fts` rows, one marker, and no stale notes FK.
- Begin `zcy(b)`: prefix-append chunk retention, v16 durable note provenance with span hash, backup-backed repair script, production VACUUM backup, and dry-run evidence.
- `zcy(c)` remains notes in hybrid retrieval after part (b) lands.

Do not include unrelated work in the commit.

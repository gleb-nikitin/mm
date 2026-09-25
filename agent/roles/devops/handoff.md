# Devops Handoff

Current task: `zcy`, shipped as three ordered commits. Part (a) landed as `61b21c9`; part (b) passed audit at `zcy-13` and is included in HEAD.

Part (b) behavior:
- Exact raw-content prefix growth retains every existing chunk ID and processed bit, reconciles retained chunks to the event's current project, and emits only the raw suffix. Non-prefix rewrites and explicit `--rechunk` invalidate queue chunks.
- Schema v16 snapshots each note's source event/external ID, raw character span, filter version, and SHA-256 span hash. Note reads report `valid`, `stale`, `missing`, or `unresolved` by checking the current raw span.
- `addNote()` captures provenance atomically with the note. The v15→v16 migration backfills notes whose live chunk remains.
- `scripts/repair-note-provenance.ts` derives old span text from the backup DB, accepts same-offset matches, uniquely relocates exact spans, and refuses missing/ambiguous spans. Apply mode revalidates inside an immediate transaction.
- Chunk coordinates, prefix detection, and span hashes all use `raw_events.content`; `filterMechanical` runs only after slicing in `readChunk()`.

Production safety/evidence:
- Watcher is intentionally stopped; API remains healthy on committed part (a).
- Pre-repair VACUUM backup exists and passed integrity check: `/Users/glebnikitin/Library/Application Support/com.aurora.core/data/backups/mm-brain-pre-note-provenance-repair-20260925T0355Z.db`.
- Dry-run against the pre-Codex-backfill DB + saved CSV: 94 rows; 88 resolved (84 same offset, 4 relocated); 6 unresolved (notes 48/57 span not found, notes 78–81 lacked backup coordinates). No repair writes applied.

Audit/commit scope for `zcy(b)` only:
- `scripts/chunk-events.ts`
- `scripts/repair-note-provenance.ts`
- `src/api.ts`
- `src/core.ts`
- `tests/behavior.test.ts`
- `tests/brief.test.ts`
- `agent/roles/devops/handoff.md`

Verification:
- Focused behavior tests: 25 pass, 0 fail, 216 expectations.
- Full `bun test`: 163 pass, 0 fail, 818 expectations.
- `bun run typecheck` and `git diff --check`: passed.

After commit: migrate production, run repair `--apply`, verify 88 valid / 6 unresolved, restart watcher, then begin `zcy(c)` notes retrieval. Exclude every other dirty path.

# Devops Handoff

Current state: the repeated-`session_meta` identity fix passed audit at `ywu-47` and is included in HEAD; final production import verification remains.

Contract implemented:
- `MT_CODEX_SESSIONS_DIR` is an ordered `:` list with leading `~/` expansion and default `~/.codex/sessions`.
- Explicit importer/probe overrides replace the environment list.
- Root order selects one winner per session before mutation; force, mtime, scan order, and days filtering cannot promote a fallback.
- Winner imports self-heal stale `session_index.source_path`; losing Codex `import_state` rows are removed.
- Missing roots warn while available roots continue; all missing roots fail.
- Live probe uses the same winner order, including inactive-primary shadowing.
- Watch uses `process.execPath` and emits child stderr only when diagnostics change.
- Both managed processes receive `$AURORA_DATA/data/codex-home/sessions:~/.codex/sessions`.
- Current Codex `response_item` user messages with `input_text` are parsed alongside legacy `event_msg` prompts.
- Classified non-`user.text` and recognizable unannotated AGENTS/environment/plugin context records are excluded symmetrically by importer and probe.

Current audit/commit scope:
- `scripts/import-codex.ts`, `tests/r1-session-index.test.ts`, this handoff

Verification:
- `bun test`: 152 pass, 0 fail, 738 expectations.
- Targeted repeated-metadata suite: 21 pass, 0 fail, 104 expectations.
- `bun run typecheck`: passed.
- `git diff --check`: passed.
- Real-root live probe over both stores: 14.4 ms, below the documented 50 ms target.
- Minimal-PATH watcher test proves children start without `bun` on PATH and repeated missing-root stderr is emitted once.

Production state:
- Restored the pre-backfill DB and reran full history with the audited context filter: 284 missing before, 1 after; 283 inserted, 53 updated, 410 unchanged.
- The one gap is a rollout with first ID `01a09c2f…` and later repeated metadata for `01a095ee…`; importer must retain the first identity like winner selection.
- Required DB rows already point correctly: 11 post-switch codex-home rows, all four duplicate IDs have one codex-home row, and `01a0adda…` is present.
- Four of 11 noted Codex events changed; stale-note count increased from 4 to 20, so 16 notes lost their chunk. Provenance backup remains for `zcy`.

Unrelated dirty files belong to CTO/git work and must be excluded from this commit.

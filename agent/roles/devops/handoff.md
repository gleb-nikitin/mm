# Devops Handoff

Current state: the `ywu` current Codex prompt parser follow-up landed at HEAD (`d14565a`); production reload/backfill remains.

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

Incremental audit/commit scope:
- `scripts/import-codex.ts`, `src/session-probe.ts`
- `tests/active-agents.test.ts`, `tests/r1-session-index.test.ts`, this handoff

Verification:
- `bun test`: 147 pass, 0 fail, 721 expectations.
- Targeted tests: 46 pass, 0 fail, 179 expectations.
- `bun run typecheck`: passed.
- `git diff --check`: passed.
- Real-root live probe over both stores: 14.4 ms, below the documented 50 ms target.
- Minimal-PATH watcher test proves children start without `bun` on PATH and repeated missing-root stderr is emitted once.

Production state:
- Root-manifest reconciliation replaced both old processes; exactly one API and watcher run with the ordered env, and the plugin symlink remains intact.
- First backfill found 180 winners / 4 shadowed copies but exposed the current-format gap: 179 skipped for min-turns. Do not treat that run as complete.
- Reload HEAD, rerun the measured backfill range, and verify post-switch codex-home rows, four duplicate IDs, and `01a0adda…` in `meta/brain.db`.

Unrelated dirty files belong to CTO/git work and must be excluded from this commit.

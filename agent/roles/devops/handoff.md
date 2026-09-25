# Devops Handoff

Current state: the final `ywu` host-context filter passed audit at `ywu-38` and is included in HEAD; production cleanup/re-backfill remains.

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
- `src/codex-sessions.ts`, `scripts/import-codex.ts`, `src/session-probe.ts`
- `tests/codex-sessions.test.ts`, `tests/active-agents.test.ts`, `tests/r1-session-index.test.ts`
- this handoff

Verification:
- `bun test`: 150 pass, 0 fail, 729 expectations.
- Targeted tests: 52 pass, 0 fail, 191 expectations.
- `bun run typecheck`: passed.
- `git diff --check`: passed.
- Real-root live probe over both stores: 14.4 ms, below the documented 50 ms target.
- Minimal-PATH watcher test proves children start without `bun` on PATH and repeated missing-root stderr is emitted once.

Production state:
- Exactly one API and watcher run with the ordered env; the plugin symlink remains intact.
- Full-history measurement found 1,928 winners, 4 shadowed copies, and 1,639 initially eligible sessions; 1,173 lacked raw events, including 1,101 before September 12.
- The first full backfill imported 1,172 before verification exposed unannotated host-context inflation: filtering known host records makes 896 sessions fall below min-turns.
- Reload HEAD in both processes, remove only false rows introduced by the bad backfill, rerun `--days 0 --force`, and verify coverage plus the required duplicate/post-switch rows in `meta/brain.db`.

Unrelated dirty files belong to CTO/git work and must be excluded from this commit.

# Devops Handoff

Current state: `ywu` Codex multi-root import and watcher reliability passed audit at `ywu-11` and is included in HEAD; no active devops implementation remains.

Contract implemented:
- `MT_CODEX_SESSIONS_DIR` is an ordered `:` list with leading `~/` expansion and default `~/.codex/sessions`.
- Explicit importer/probe overrides replace the environment list.
- Root order selects one winner per session before mutation; force, mtime, scan order, and days filtering cannot promote a fallback.
- Winner imports self-heal stale `session_index.source_path`; losing Codex `import_state` rows are removed.
- Missing roots warn while available roots continue; all missing roots fail.
- Live probe uses the same winner order, including inactive-primary shadowing.
- Watch uses `process.execPath` and emits child stderr only when diagnostics change.
- Both managed processes receive `$AURORA_DATA/data/codex-home/sessions:~/.codex/sessions`.

Audit/commit scope:
- `src/codex-sessions.ts`, `src/session-probe.ts`
- `scripts/import-codex.ts`, `scripts/watch.ts`, `processes.toml`
- `tests/codex-sessions.test.ts`, `tests/active-agents.test.ts`, `tests/r1-session-index.test.ts`, `tests/watch.test.ts`, `tests/processes-manifest.test.ts`
- `README.md`, `human-how-it-works.md`, `agent/docs/how-to-import.md`, this handoff

Verification:
- `bun test`: 146 pass, 0 fail, 715 expectations.
- `bun run typecheck`: passed.
- `git diff --check`: passed.
- Real-root live probe over both stores: 14.4 ms, below the documented 50 ms target.
- Minimal-PATH watcher test proves children start without `bun` on PATH and repeated missing-root stderr is emitted once.

Production backfill gate:
- Running `mm-watch` PID 38653 has no `MT_CODEX_SESSIONS_DIR`; do not backfill until managed processes reload the new manifest.
- After reload, import from 2026-09-12 onward and verify post-switch codex-home rows plus duplicate IDs `01a0930f…`, `01a0951f…`, `01a095ee…`, `01a09cbf…` in `meta/brain.db`.

Unrelated dirty files belong to CTO/git work and must be excluded from this commit.

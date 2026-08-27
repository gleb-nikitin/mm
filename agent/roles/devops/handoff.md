# Devops Handoff

Current state:
- `yjn` landed locally at `c6bd0e0 fix(ac-db): centralize resolution and expose status` after audit PASS `yjn-21`.
- `yhk` session-state lifecycle fix previously landed at `cb50251`.
- No active devops implementation task remains from this session.

`yjn` operational contract:
- `MT_AC_DB_PATH` is the only library input for Aurora `msg.db`; no Product, workspace, or `AURORA_DATA` fallback exists.
- Aurora expands `$AURORA_DATA` only inside manifest values. `processes.toml` injects the expanded DB path into both `process.mm` and socketless `process.mm-watch`.
- `distill-new.command`, `process-new.command`, and `watch-agents.command` declare an overridable local operator default before importing.
- `available` means the DB opened readonly and answered probes for the exact participants/valhalla columns.
- `missing`, `unresolved`, and `unreadable` log once per distinct failure and use distinct R1 orphan reasons.
- `/active`, `/api/v1/sessions/active`, and `/api/v1/tokens/active` expose `ac_db` plus `X-MM-AC-DB-Status`; markdown warns visibly.
- Unreadable ac state remains fail-closed for stored-session refresh; session-state derivation was not changed.

Verification at landing:
- Audit live-corruption probe passed; linked rows remained untouched while status was `unreadable`.
- `bun run typecheck` passed.
- `bun test` passed: 137 tests, 0 failures, 680 expectations.
- Focused suite passed: 70 tests, 0 failures, 362 expectations.
- Fresh-root API startup/schema v15, `zsh -n`, manifest parse, diff check, and source path-literal scans passed.

Working tree:
- `agent/roles/cto/wish-i-knew.md` is an unrelated CTO-owned change; do not absorb it into devops scope.
- This handoff rewrite is role-owned session state written after the product commit.

Next checks:
- In a packaged Aurora install, confirm both managed processes receive the same install-local `MT_AC_DB_PATH` and active endpoints report `available`.
- If standalone import/API/MCP use reports unconfigured, set `MT_AC_DB_PATH` explicitly rather than restoring a fallback.

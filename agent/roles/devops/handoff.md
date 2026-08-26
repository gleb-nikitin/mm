# Devops Handoff

Current tasks:
- `yhk`: session-state fix reworked after terminal resurrection FAIL; re-audit requested at `yhk-15`.
- `yfj-1`: notes UI/API + stale-FK self-heal remains awaiting audit.
- `yfg`: parked pending amended simplified distill dispatch.

`yhk` behavior:
- Links preserve `active | retired`; retired observations store `completed`.
- Age tops out at `idle`; only explicit state sets `wedged`; readers trust stored state.
- Reconciliation preserves non-reconstructible `completed` and `wedged`; genuine transcript observations alone may reactivate them.
- Each importer reconciles all stored vendor rows, including outside `--days`, without transcript reparse.
- Durable `import_state` marker gates each vendor scan to 30s; claim is atomic; unchanged rows are not written.
- Missing ac DB leaves session rows untouched; no `llm_query_log` dependency.

Scope:
- `src/r1/{types,ac-link,session-state,session-index}.ts`
- three `scripts/import-*.ts` vendor importers
- `tests/{r1-state,r1-session-index,r1-api}.test.ts`
- `human-how-it-works.md`, `agent/docs/how-to-import.md`

Verification:
- Terminal test forces metadata write: completed/wedged/retired-completed survive, no reverse event, active tokens only wedged.
- Interval test proves run/not-due/run across 30s.
- Real non-force Claude: unchanged working → idle → retired/completed; active tokens empty.
- Focused 47 pass/297 expectations; typecheck passed; full 129 pass/638 expectations.
- Fresh-root CLI/MCP/API/schema v15 and diff/forbidden checks passed.

Next:
- Wait for `mm_audit` PASS/FAIL on `yhk-15`; PASS routes exact 12 files to `mm_git`.
- After merge, run one-time `scripts/backfill-r1.ts` in production for legacy stored states.
- Exclude unrelated dirty role/doc/config files from commit.

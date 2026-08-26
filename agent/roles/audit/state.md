No active audit task after verdict.

Latest audit checked read-time active-session state derivation from mm_devops on chain xjp.
Verdict: PASS sent directly to `mm_git` for `xjp-4`.

Scope:
- `src/r1/session-index.ts`
- `tests/r1-session-index.test.ts`
- `tests/r1-api.test.ts`

Evidence checked locally:
- `bun run typecheck` passed.
- `bun test tests/r1-session-index.test.ts tests/r1-api.test.ts` passed.
- `git diff --check` passed.
- Live temp-root smoke passed for stale stored `working` deriving to `wedged`, `state=wedged` including it, and `state=working` excluding it.
- Did not rerun full suite; relied on devops-reported `bun test` pass for `xjp-4`.

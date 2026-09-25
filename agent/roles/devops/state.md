# mm_devops state

Current tasks:
- `yfj-1`: notes UI/API + stale-FK self-heal implemented; awaiting audit.
- `yfg`: parked pending amended simplified distill command dispatch.

Status:
- `yff-1` notes table + `brain note add` was committed at `5ddbcd6 feat(brain): add distilled notes surface`.
- `yfe-10/11` mm `do` docs are done in `CLAUDE.md` and `agent/do-tools/index.md`.
- `yfg-4` temp-DB `scripts/distill-run.ts` was canceled/reverted after `yfg-3`; no yfg product diff remains.
- `yfg-7` FAIL is valid for the reverted file only; carry forward the lesson that failed `brain note add` must not mark chunks processed.

Implemented for `yfj-1`:
- Core note list/detail/search helpers and stale FK self-heal.
- API routes `/notes`, `/note/:id`, `/notes-search`, `/notes-ui`, help entries, nav.
- `ui/notes.html` with safe limited markdown rendering and no raw HTML passthrough.
- Behavior tests for migration and notes API edge cases.

Verification:
- `bun run typecheck` passed.
- `bun test tests/behavior.test.ts -t "schema migration|notes API"` passed.
- `bun test` passed: 125 pass, 0 fail, 610 expectations.
- Diff/whitespace checks passed for scoped files.

Next:
- Wait for audit result on `yfj-5`.
- If PASS, send to `mm_git` for `src/core.ts`, `src/api.ts`, `ui/notes.html`, `tests/behavior.test.ts`.
- Exclude unrelated dirty role/doc/config files unless scoped by owner.

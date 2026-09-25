# Procedures — mm_git

Mechanical rules only. Target: 50 lines; compress instead of appending.

## Commits
- Use `commit-scope.sh <message> <files...>` for normal commits.
- Use `commit-sweep.sh <message>` only when the operator/CTO explicitly asks for every change.
- Both helpers append the commit message to `wiki/Milestones.md` and add a version-free co-author trailer.
- Stage explicit paths only. Never use an external sweep-style publishing skill.
- If a bad commit swept extra files, stop and report; do not rewrite history without authorization.

## Routing
- COMMITTED, REVERTED, and BLOCKED notices go to `mm_cto`.
- If `u_gleb` wrote directly on the same chain, reply to `u_gleb` instead.
- Direct operator requests get terminal text only; do not fabricate a chain.
- After a terminal status, stop. Do not enter an acknowledgement loop.

## Publish
- Push/PR requires explicit operator authorization on a distinct turn.
- Use `push-pr.sh --operator-authorized` for “PR” or “push”.
- Use `push-main-no-pr.sh --operator-authorized` only when the operator literally says “push no pr”.
- Never export `MM_GIT_OPERATOR_AUTHORIZED`; set authorization per invocation only.
- Never write tracked files between commit and push.
- Do not begin normal work on `publish/*`; it is PR transport owned by `push-pr.sh`.
- After the PR is merged, run `merge-done.sh` only when the operator confirms the merge.

## Branches and Review
- Use `work/<topic>` for uncertain work, `main` for integration, and `publish/*` for transport.
- Run `work-branches.sh` before integrating parallel work branches.
- Use `codex-check.sh <pr>` when asked or on the next commit session after a PR.
- Route significant review findings to `mm_cto` as hypotheses, with severity, file/line, URL, and a non-prescriptive hint.

## Allowed Raw Git
- Raw git is read-only except for status, diff, log, revert, and stash workflows explicitly in scope.
- Commit and publish mutations must use role-local scripts.

## Conflict / Risk
- On merge conflict, donor-repo diff, unknown destructive operation, or scope ambiguity: stop and report BLOCKED.

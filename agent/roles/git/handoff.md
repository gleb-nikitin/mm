# Handoff — mm_git

## Current Status
- No active task after audit PASS `yjn-21`.
- Current HEAD is the local commit for canonical ac DB resolution and loud active-surface status; use `git log -1` for its SHA.
- No push, PR, or remote operation occurred.

## Included in HEAD
- Nineteen audited runtime, test, manifest, operator-script, and documentation paths from `yjn-21`.
- This handoff plus the automated milestone entry.
- Docs now state that standalone processes must receive `MT_AC_DB_PATH`; managed processes receive it through `processes.toml`.

## Verification
- Audit reported focused tests 42/0, full suite 137/0 with 680 expectations, typecheck pass, operator-script syntax pass, and clean diff/source sweeps.
- mm_git rechecked the scoped diff and documentation before commit.

## Preserved Exclusion
- `agent/roles/cto/wish-i-knew.md` remains modified and uncommitted by explicit audit instruction; it is not mm_git handoff dirt.

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCOPE_SUT="$SCRIPT_DIR/commit-scope.sh"
SWEEP_SUT="$SCRIPT_DIR/commit-sweep.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mm-commit-helper-test.XXXXXX")"
REPO="$TEST_ROOT/repo"

cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

git init -q -b main "$REPO"
git -C "$REPO" config user.name "Commit Helper Test"
git -C "$REPO" config user.email "commit-helper-test@example.invalid"
mkdir -p "$REPO/wiki"
printf 'initial\n' > "$REPO/target.txt"
printf 'initial\n' > "$REPO/sweep.txt"
printf 'legacy secret\n' > "$REPO/.env.old"
printf '# Milestones\n' > "$REPO/wiki/Milestones.md"
git -C "$REPO" add target.txt sweep.txt .env.old wiki/Milestones.md
git -C "$REPO" commit -q -m initial

printf 'attached\n' > "$REPO/target.txt"
MM_GIT_REPO="$REPO" "$SCOPE_SUT" "attached control" target.txt >/dev/null
[[ "$(git -C "$REPO" symbolic-ref -q HEAD)" == refs/heads/main ]] || fail "scoped commit left main"
git -C "$REPO" show --name-only --format= HEAD | grep -Fxq wiki/Milestones.md || fail "scoped commit omitted milestone"

scoped_tip="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" switch --detach -q
printf 'detached\n' > "$REPO/target.txt"
rc=0
output="$(MM_GIT_REPO="$REPO" "$SCOPE_SUT" "must refuse" target.txt 2>&1)" || rc=$?
[[ $rc -eq 1 ]] || fail "detached scoped commit returned rc $rc"
grep -Fq "refusing to commit on a detached HEAD" <<<"$output" || fail "missing detached scoped refusal"
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$scoped_tip" ]] || fail "detached scoped commit wrote history"
[[ -z "$(git -C "$REPO" stash list)" ]] || fail "detached scoped commit wrote a stash"

git -C "$REPO" restore -- target.txt
git -C "$REPO" switch main -q
printf 'attached sweep\n' > "$REPO/sweep.txt"
MM_GIT_REPO="$REPO" "$SWEEP_SUT" "attached sweep control" >/dev/null
git -C "$REPO" show --name-only --format= HEAD | grep -Fxq wiki/Milestones.md || fail "sweep omitted milestone"

sweep_tip="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" switch --detach -q
printf 'detached sweep\n' > "$REPO/sweep.txt"
rc=0
output="$(MM_GIT_REPO="$REPO" "$SWEEP_SUT" "must refuse" 2>&1)" || rc=$?
[[ $rc -eq 1 ]] || fail "detached sweep returned rc $rc"
grep -Fq "refusing to commit on a detached HEAD" <<<"$output" || fail "missing detached sweep refusal"
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$sweep_tip" ]] || fail "detached sweep wrote history"
[[ -z "$(git -C "$REPO" stash list)" ]] || fail "detached sweep wrote a stash"

git -C "$REPO" restore -- sweep.txt
git -C "$REPO" switch main -q
printf 'staged secret\n' > "$REPO/.env"
git -C "$REPO" add .env
printf 'must remain modified\n' > "$REPO/sweep.txt"
refusal_head="$(git -C "$REPO" rev-parse HEAD)"
refusal_index="$(git -C "$REPO" diff --cached --binary | git hash-object --stdin)"
refusal_milestone="$(git -C "$REPO" hash-object wiki/Milestones.md)"
rc=0
output="$(MM_GIT_REPO="$REPO" "$SWEEP_SUT" "must refuse staged secret" 2>&1)" || rc=$?
[[ $rc -eq 1 ]] || fail "staged-secret sweep returned rc $rc"
grep -Fq "refusing sweep because excluded paths are staged" <<<"$output" || fail "missing staged-secret refusal"
grep -Fq ".env (secret)" <<<"$output" || fail "staged-secret refusal omitted path"
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$refusal_head" ]] || fail "staged-secret refusal wrote history"
[[ "$(git -C "$REPO" diff --cached --binary | git hash-object --stdin)" == "$refusal_index" ]] || fail "staged-secret refusal changed index"
[[ "$(git -C "$REPO" hash-object wiki/Milestones.md)" == "$refusal_milestone" ]] || fail "staged-secret refusal changed milestones"
grep -Fxq "must remain modified" "$REPO/sweep.txt" || fail "staged-secret refusal changed worktree"

git -C "$REPO" restore --staged -- .env
rm -f "$REPO/.env"
git -C "$REPO" restore -- sweep.txt
git -C "$REPO" mv .env.old renamed-safe.txt
rename_head="$(git -C "$REPO" rev-parse HEAD)"
rc=0
output="$(MM_GIT_REPO="$REPO" "$SWEEP_SUT" "must refuse excluded rename source" 2>&1)" || rc=$?
[[ $rc -eq 1 ]] || fail "excluded-rename sweep returned rc $rc"
grep -Fq ".env.old (secret)" <<<"$output" || fail "refusal omitted excluded rename source"
[[ "$(git -C "$REPO" rev-parse HEAD)" == "$rename_head" ]] || fail "excluded-rename refusal wrote history"
git -C "$REPO" restore --staged -- .env.old renamed-safe.txt
git -C "$REPO" restore -- .env.old
rm -f "$REPO/renamed-safe.txt"

printf 'space\n' > "$REPO/space name.txt"
printf 'unicode\n' > "$REPO/café.txt"
MM_GIT_REPO="$REPO" "$SWEEP_SUT" "literal pathnames" >/dev/null
git -C "$REPO" cat-file -e "HEAD:space name.txt" || fail "sweep omitted path containing spaces"
git -C "$REPO" cat-file -e "HEAD:café.txt" || fail "sweep omitted non-ASCII path"

printf 'literal wildcard\n' > "$REPO/*"
printf 'must stay untracked\n' > "$REPO/.env"
MM_GIT_REPO="$REPO" "$SWEEP_SUT" "literal wildcard pathspec" >/dev/null
git -C "$REPO" cat-file -e "HEAD:*" || fail "sweep omitted literal wildcard filename"
if git -C "$REPO" cat-file -e "HEAD:.env" 2>/dev/null; then
  fail "literal wildcard pathspec committed excluded .env"
fi
[[ "$(git -C "$REPO" status --porcelain -- .env)" == "?? .env" ]] || fail "literal wildcard pathspec staged excluded .env"

echo "PASS: commit helpers append milestones, refuse unsafe states, and preserve literal pathnames"

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
printf '# Milestones\n' > "$REPO/wiki/Milestones.md"
git -C "$REPO" add target.txt sweep.txt wiki/Milestones.md
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

echo "PASS: commit helpers append milestones, commit attached, and refuse detached HEAD"

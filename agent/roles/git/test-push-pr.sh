#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PUSH_SUT="$SCRIPT_DIR/push-pr.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mm-push-pr-test.XXXXXX")"
BIN="$TEST_ROOT/bin"

cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

mkdir -p "$BIN"
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-} ${2:-}" in
  "auth status") exit 0 ;;
  "pr create")
    if [[ "${GH_TEST_MODE:-}" == "create-fail" ]]; then exit 44; fi
    if [[ "${GH_TEST_MODE:-}" == "success" ]]; then
      printf 'https://github.com/example/repo/pull/123\n'
      exit 0
    fi
    printf 'opaque-pr-reference\n'
    ;;
  "pr view") exit 45 ;;
  *) exit 46 ;;
esac
GH
chmod +x "$BIN/gh"

make_repo() {
  local name="$1" repo="$TEST_ROOT/$1-repo" origin="$TEST_ROOT/$1-origin.git"
  git init -q --bare "$origin"
  git init -q -b main "$repo"
  git -C "$repo" config user.name "Push Helper Test"
  git -C "$repo" config user.email "push-helper-test@example.invalid"
  mkdir -p "$repo/agent/roles/git"
  cp "$PUSH_SUT" "$repo/agent/roles/git/push-pr.sh"
  printf 'initial\n' > "$repo/tracked.txt"
  git -C "$repo" add agent/roles/git/push-pr.sh tracked.txt
  git -C "$repo" commit -q -m initial
  git -C "$repo" remote add origin "$origin"
  git -C "$repo" push -q -u origin main
  printf 'ahead\n' >> "$repo/tracked.txt"
  git -C "$repo" commit -q -am "ahead $name"
  ln -s "$repo" "$TEST_ROOT/$name-link"
  printf '%s\n' "$repo"
}

assert_failure_cleanup() {
  local repo="$1" branch="$2" output="$3"
  [[ "$(git -C "$repo" symbolic-ref --short HEAD)" == main ]] || fail "$branch failure did not return to main"
  git -C "$repo" show-ref --verify --quiet "refs/heads/$branch" || fail "$branch failure removed local branch"
  [[ ! -f "$repo/.git/git-publish-anchor" ]] || fail "$branch failure wrote anchor"
  grep -Fq "branch kept: $branch" <<<"$output" || fail "$branch failure did not report branch name"
}

push_repo="$(make_repo push-fail)"
cat > "$push_repo/.git/hooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
exit 42
HOOK
chmod +x "$push_repo/.git/hooks/pre-push"
rc=0
output="$(PATH="$BIN:$PATH" "$TEST_ROOT/push-fail-link/agent/roles/git/push-pr.sh" --operator-authorized --topic push-fail 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || fail "push failure returned success"
assert_failure_cleanup "$push_repo" "publish/push-fail" "$output"
if git --git-dir="$TEST_ROOT/push-fail-origin.git" show-ref --verify --quiet refs/heads/publish/push-fail; then
  fail "failed push unexpectedly created remote branch"
fi

create_repo="$(make_repo create-fail)"
rc=0
output="$(PATH="$BIN:$PATH" GH_TEST_MODE=create-fail "$TEST_ROOT/create-fail-link/agent/roles/git/push-pr.sh" --operator-authorized --topic create-fail 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || fail "PR-create failure returned success"
assert_failure_cleanup "$create_repo" "publish/create-fail" "$output"
git --git-dir="$TEST_ROOT/create-fail-origin.git" show-ref --verify --quiet refs/heads/publish/create-fail || fail "PR-create failure removed remote branch"

lookup_repo="$(make_repo lookup-fail)"
rc=0
output="$(PATH="$BIN:$PATH" GH_TEST_MODE=lookup-fail "$TEST_ROOT/lookup-fail-link/agent/roles/git/push-pr.sh" --operator-authorized --topic lookup-fail 2>&1)" || rc=$?
[[ $rc -ne 0 ]] || fail "PR-lookup failure returned success"
assert_failure_cleanup "$lookup_repo" "publish/lookup-fail" "$output"
git --git-dir="$TEST_ROOT/lookup-fail-origin.git" show-ref --verify --quiet refs/heads/publish/lookup-fail || fail "PR-lookup failure removed remote branch"
grep -Fq "gh pr list --head publish/lookup-fail" <<<"$output" || fail "PR-lookup failure omitted recovery command"

success_repo="$(make_repo success)"
output="$(PATH="$BIN:$PATH" GH_TEST_MODE=success "$TEST_ROOT/success-link/agent/roles/git/push-pr.sh" --operator-authorized --topic success 2>&1)" || fail "successful publish returned failure"
[[ "$(git -C "$success_repo" symbolic-ref --short HEAD)" == main ]] || fail "successful publish did not return to main"
[[ "$(sed -n '1p' "$success_repo/.git/git-publish-anchor")" == 123 ]] || fail "successful publish wrote wrong PR number"
git --git-dir="$TEST_ROOT/success-origin.git" show-ref --verify --quiet refs/heads/publish/success || fail "successful publish omitted remote branch"
grep -Fq "pushed publish/success" <<<"$output" || fail "successful publish omitted result"

echo "PASS: push-pr returns to main, retains publish branches, and reports recovery details"

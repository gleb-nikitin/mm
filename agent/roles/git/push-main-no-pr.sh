#!/usr/bin/env bash
set -euo pipefail

# push-main-no-pr.sh — direct push of main, only for literal operator authorization.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
die() { echo "error: $1" >&2; exit 1; }

AUTHZ="${MM_GIT_OPERATOR_AUTHORIZED:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --operator-authorized) AUTHZ=1; shift ;;
    *) die "unknown arg: $1" ;;
  esac
done

if [[ "$AUTHZ" != "1" ]]; then
  cat >&2 <<'GATE'
error: push-main-no-pr requires explicit operator authorization.

Use only when u_gleb literally says “push no pr” on this turn:
  push-main-no-pr.sh --operator-authorized
GATE
  exit 3
fi

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"
branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == "main" ]] || die "repository must be on main (current: ${branch:-detached})"
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty — commit or stash first"

git push --quiet -u origin main
echo "pushed main"
echo "sha: $(git rev-parse --short HEAD)"

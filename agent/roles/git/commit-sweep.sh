#!/usr/bin/env bash
set -euo pipefail

# commit-sweep.sh — sweep-all commit for mm_git.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
TRAILER="Co-Authored-By: Claude Opus 3.5 (1M context) <noreply@anthropic.com>"

die() { echo "error: $1" >&2; exit 1; }

[[ $# -lt 1 ]] && echo "usage: commit-sweep.sh <message>" && exit 2
MSG="$1"

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"

# Stage all except ignored
git add .

if [[ -z "$(git status --porcelain)" ]]; then
  echo "nothing to commit"
  exit 0
fi

git commit --quiet -m "$(printf '%s\n\n%s\n' "$MSG" "$TRAILER")"
sha="$(git rev-parse --short HEAD)"

echo "committed $sha (sweep)"
echo "message: $MSG"

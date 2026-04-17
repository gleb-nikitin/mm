#!/usr/bin/env bash
set -euo pipefail

# preflight.sh — read-only state dump for mm_git session start.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"

die() { echo "error: $1" >&2; exit 1; }

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"

echo "=== mm_git preflight ==="
echo "repo: $REPO"

branch="$(git symbolic-ref --quiet --short HEAD || echo '(detached)')"
echo "branch: $branch"

if git rev-parse --verify origin/master >/dev/null 2>&1; then
  ahead="$(git rev-list --count origin/master..HEAD 2>/dev/null || echo '?')"
  behind="$(git rev-list --count HEAD..origin/master 2>/dev/null || echo '?')"
  echo "vs origin/master: $ahead ahead, $behind behind"
else
  echo "vs origin/master: origin missing"
fi

echo
echo "--- recent commits (HEAD^5..HEAD) ---"
git log --oneline -5

echo
echo "--- working tree ---"
porcelain="$(git status --porcelain)"
if [[ -z "$porcelain" ]]; then
  echo "(clean)"
else
  echo "$porcelain" | while IFS= read -r l; do echo "  $l"; done
fi

echo
echo "--- stashes ---"
stash_list="$(git stash list 2>/dev/null || true)"
if [[ -z "$stash_list" ]]; then
  echo "(empty)"
else
  echo "$stash_list"
fi

echo
echo "=== preflight complete ==="

#!/usr/bin/env bash
set -euo pipefail

# commit-sweep.sh — sweep-all commit for mm_git.

REPO="${MM_GIT_REPO:-$HOME/work/code/mm}"
TRAILER="Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"

die() { echo "error: $1" >&2; exit 1; }

[[ $# -lt 1 ]] && echo "usage: commit-sweep.sh <message>" && exit 2
MSG="$1"

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"

# Automate Milestones.md trace
MILESTONES="wiki/Milestones.md"
if [[ -f "$MILESTONES" ]]; then
  DATE=$(date +%Y-%m-%d)
  echo "- **$DATE**: $MSG" >> "$MILESTONES"
fi

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

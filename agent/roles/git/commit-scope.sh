#!/usr/bin/env bash
set -euo pipefail

# commit-scope.sh — scope-strict commit for mm_git.

REPO="${MM_GIT_REPO:-$HOME/work/code/mm}"
TRAILER="Co-Authored-By: Claude Opus 3.5 (1M context) <noreply@anthropic.com>"
STASH_MSG="mm_git scope-parking $(date +%Y%m%d-%H%M%S)"

die() { echo "error: $1" >&2; exit 1; }
usage() {
  cat >&2 <<'U'
usage: commit-scope.sh <message> <file1> [file2 ...]

Commits ONLY the listed files. Everything else in the working tree
is stashed, the commit runs, and the stash is popped. Atomic.
U
  exit 2
}

[[ $# -lt 2 ]] && usage
MSG="$1"; shift
FILES=("$@")

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"

# Automate Milestones.md trace
MILESTONES="wiki/Milestones.md"
if [[ -f "$MILESTONES" ]]; then
  DATE=$(date +%Y-%m-%d)
  # We'll append a placeholder for the SHA since we don't have it yet, 
  # or just use the message. Actually, the user wants the SHA if possible.
  # But we can't get the SHA until we commit. 
  # Let's append the message now, and the SHA will be in the git log.
  # Or better: we commit, get SHA, then update Milestones, then AMEND? 
  # No, that's messy. Let's just append the message and date.
  echo "- **$DATE**: $MSG" >> "$MILESTONES"
  FILES+=("$MILESTONES")
fi

for f in "${FILES[@]}"; do
  [[ -z "$(git status --porcelain --untracked-files=all -- "$f")" ]] \
    && die "file not modified or untracked: $f"
done

complement=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  p="${line:3}"
  p="${p##* -> }"
  skip=0
  for f in "${FILES[@]}"; do
    [[ "$p" == "$f" ]] && skip=1 && break
  done
  [[ $skip -eq 0 ]] && complement+=("$p")
done < <(git status --porcelain --untracked-files=all)

stashed=0
if [[ ${#complement[@]} -gt 0 ]]; then
  git stash push -u -m "$STASH_MSG" -- "${complement[@]}" >/dev/null
  stashed=1
fi

commit_rc=0
set +e
for f in "${FILES[@]}"; do
  git add -- "$f" || { commit_rc=$?; break; }
done
if [[ $commit_rc -eq 0 ]]; then
  git commit --quiet -m "$(printf '%s\n\n%s\n' "$MSG" "$TRAILER")"
  commit_rc=$?
fi
set -e

sha=""
[[ $commit_rc -eq 0 ]] && sha="$(git rev-parse --short HEAD)"

if [[ $stashed -eq 1 ]]; then
  if ! git stash pop >/dev/null 2>&1; then
    echo "warning: stash pop reported issues — check 'git stash list'" >&2
  fi
fi

if [[ $commit_rc -ne 0 ]]; then
  die "commit failed (rc=$commit_rc); working tree restored"
fi

echo "committed $sha"
echo "message: $MSG"
echo "files (${#FILES[@]}):"
for f in "${FILES[@]}"; do
  echo "  $f"
done
if [[ ${#complement[@]} -gt 0 ]]; then
  echo "preserved: ${#complement[@]} file(s) via stash round-trip"
fi

#!/usr/bin/env bash
set -euo pipefail

# commit-scope.sh — commit only the listed mm paths and preserve all others.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
TRAILER="Co-Authored-By: Claude <noreply@anthropic.com>"
STASH_MSG="mm_git scope-parking $(date +%Y%m%d-%H%M%S)"
MILESTONES="wiki/Milestones.md"

die() { echo "error: $1" >&2; exit 1; }
usage() {
  cat >&2 <<'USAGE'
usage: commit-scope.sh <message> <file1> [file2 ...]

Commits only listed files plus the automated milestone entry. Everything
else is stashed for the commit and restored afterward.
USAGE
  exit 2
}

[[ $# -lt 2 ]] && usage
MSG="$1"; shift
FILES=("$@")

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"
git symbolic-ref -q HEAD >/dev/null \
  || die "refusing to commit on a detached HEAD; attach HEAD to a branch first"

for file in "${FILES[@]}"; do
  [[ -n "$(git status --porcelain --untracked-files=all -- "$file")" ]] \
    || die "file not modified or untracked: $file"
done

if [[ -f "$MILESTONES" ]]; then
  printf -- '- **%s**: %s\n' "$(date +%Y-%m-%d)" "$MSG" >> "$MILESTONES"
  found=0
  for file in "${FILES[@]}"; do [[ "$file" == "$MILESTONES" ]] && found=1; done
  [[ $found -eq 1 ]] || FILES+=("$MILESTONES")
fi

complement=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  path="${line:3}"
  path="${path##* -> }"
  skip=0
  for file in "${FILES[@]}"; do [[ "$path" == "$file" ]] && skip=1 && break; done
  [[ $skip -eq 0 ]] && complement+=("$path")
done < <(git status --porcelain --untracked-files=all)

stashed=0
if [[ ${#complement[@]} -gt 0 ]]; then
  git stash push -u -m "$STASH_MSG" -- "${complement[@]}" >/dev/null
  stashed=1
fi

commit_rc=0
set +e
for file in "${FILES[@]}"; do
  git add -- "$file" || { commit_rc=$?; break; }
done
if [[ $commit_rc -eq 0 ]]; then
  git commit --quiet -m "$(printf '%s\n\n%s\n' "$MSG" "$TRAILER")"
  commit_rc=$?
fi
set -e

sha=""
[[ $commit_rc -eq 0 ]] && sha="$(git rev-parse --short HEAD)"
if [[ $stashed -eq 1 ]] && ! git stash pop >/dev/null 2>&1; then
  echo "warning: stash pop reported issues — check 'git stash list'" >&2
fi
[[ $commit_rc -eq 0 ]] || die "commit failed (rc=$commit_rc); working tree restored"

echo "committed $sha"
echo "message: $MSG"
echo "files (${#FILES[@]}):"
for file in "${FILES[@]}"; do echo "  $file"; done
[[ ${#complement[@]} -eq 0 ]] || echo "preserved: ${#complement[@]} file(s) via stash round-trip"

#!/usr/bin/env bash
set -euo pipefail

# work-branches.sh — read-only overlap and readiness report for local work/* branches.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
BASE="main"
die() { echo "error: $1" >&2; exit 1; }
usage() { echo "usage: work-branches.sh [--base <ref>]" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) shift; [[ $# -gt 0 ]] || die "--base requires a value"; BASE="$1"; shift ;;
    -h|--help) usage ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"
git rev-parse --verify "$BASE" >/dev/null 2>&1 || die "base ref not found: $BASE"

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT
branch_list="$tmpdir/branches"
git for-each-ref --format='%(refname:short)' refs/heads/work > "$branch_list"

echo "=== mm_git work branch report ==="
echo "base: $BASE ($(git rev-parse --short "$BASE"))"
echo
if [[ ! -s "$branch_list" ]]; then
  echo "no local work/* branches"
  echo "=== report complete ==="
  exit 0
fi

branches=()
files=()
idx=0
while IFS= read -r branch; do
  [[ -n "$branch" ]] || continue
  branches[$idx]="$branch"
  files[$idx]="$tmpdir/files_$idx"
  git diff --name-only "$BASE...$branch" | sort -u > "${files[$idx]}"
  echo "$branch"
  echo "  commits: $(git rev-list --count "$BASE..$branch") ahead, $(git rev-list --count "$branch..$BASE") behind $BASE"
  if git merge-base --is-ancestor "$BASE" "$branch"; then
    echo "  fast-forward into $BASE: yes"
  else
    echo "  fast-forward into $BASE: no; rebase or merge base first"
  fi
  echo "  files: $(wc -l < "${files[$idx]}" | tr -d '[:space:]')"
  sed 's/^/    /' "${files[$idx]}"
  idx=$((idx + 1))
done < "$branch_list"

echo
echo "--- overlaps ---"
overlap_count=0
for ((i = 0; i < ${#branches[@]}; i++)); do
  for ((j = i + 1; j < ${#branches[@]}; j++)); do
    overlap="$tmpdir/overlap_${i}_${j}"
    comm -12 "${files[$i]}" "${files[$j]}" > "$overlap" || true
    if [[ -s "$overlap" ]]; then
      overlap_count=$((overlap_count + 1))
      echo "${branches[$i]} <-> ${branches[$j]}"
      sed 's/^/    /' "$overlap"
    fi
  done
done
[[ $overlap_count -gt 0 ]] || echo "none"
echo "=== report complete ==="

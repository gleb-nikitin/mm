#!/usr/bin/env bash
set -euo pipefail

# merge-done.sh — verify a published PR merge and clean its transport branch.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
ANCHOR=".git/git-publish-anchor"
die() { echo "error: $1" >&2; exit 1; }

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"
command -v gh >/dev/null 2>&1 || die "gh is not installed"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"

branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == "main" ]] || die "repository must be on main (current: ${branch:-detached})"
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty"
[[ -f "$ANCHOR" ]] || die "no active publish cycle (anchor file missing)"

pr_number="$(sed -n '1p' "$ANCHOR" | tr -d '[:space:]')"
published_sha="$(sed -n '2p' "$ANCHOR" | tr -d '[:space:]')"
[[ "$pr_number" =~ ^[0-9]+$ ]] || die "invalid anchor: expected PR number on line 1"

git fetch --quiet origin
if [[ -n "$published_sha" && "$(git rev-parse HEAD)" != "$published_sha" ]]; then
  die "local main has commits after the published cycle; resolve them before merge-done"
fi

pr_state="$(gh pr view "$pr_number" --json state --jq '.state')"
[[ "$pr_state" == "MERGED" ]] || die "pr #$pr_number is not merged (state: $pr_state)"
head_ref="$(gh pr view "$pr_number" --json headRefName --jq '.headRefName')"
[[ -n "$head_ref" ]] || die "failed to resolve PR head branch for #$pr_number"

git reset --hard origin/main >/dev/null
if git show-ref --verify --quiet "refs/heads/$head_ref"; then git branch -D "$head_ref" >/dev/null; fi
git push origin --delete "$head_ref" >/dev/null 2>&1 || true
rm -f "$ANCHOR"

echo "verified: pr #$pr_number merged"
echo "synced main $(git rev-parse --short HEAD)"
echo "deleted: $head_ref"

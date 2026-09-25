#!/usr/bin/env bash
set -euo pipefail

# preflight.sh — read-only state dump for mm_git session start.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
ANCHOR=".git/git-publish-anchor"
REPO_SLUG="gleb-nikitin/mm"

die() { echo "error: $1" >&2; exit 1; }

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"

echo "=== mm_git preflight ==="
echo "repo: $REPO"

branch="$(git symbolic-ref --quiet --short HEAD || echo '(detached)')"
echo "branch: $branch"

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  ahead="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
  behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
  echo "vs origin/main: $ahead ahead, $behind behind"
else
  echo "vs origin/main: origin missing"
fi

echo
echo "--- recent commits (HEAD^5..HEAD) ---"
git log --oneline -5

if [[ "$branch" == "main" ]] && git rev-parse --verify origin/main >/dev/null 2>&1; then
  ahead_count="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
  if [[ "$ahead_count" -gt 0 ]]; then
    echo
    echo "--- unpushed commits (origin/main..HEAD) ---"
    git log --oneline origin/main..HEAD
  fi
fi

echo
echo "--- working tree ---"
porcelain="$(git status --porcelain)"
if [[ -z "$porcelain" ]]; then
  echo "(clean)"
else
  while IFS= read -r line; do echo "  $line"; done <<<"$porcelain"
fi

echo
echo "--- publish cycle ---"
if [[ -f "$ANCHOR" ]]; then
  pr_number="$(sed -n '1p' "$ANCHOR" | tr -d '[:space:]')"
  published_sha="$(sed -n '2p' "$ANCHOR" | tr -d '[:space:]')"
  echo "ACTIVE — pr #$pr_number, published sha ${published_sha:0:12}"
  echo "  next step: operator merges on GitHub, then merge-done.sh"
else
  echo "(none — no active publish anchor)"
fi

echo
echo "--- stashes ---"
stash_list="$(git stash list 2>/dev/null || true)"
if [[ -z "$stash_list" ]]; then echo "(empty)"; else echo "$stash_list"; fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  last_pr="$(gh pr list --repo "$REPO_SLUG" --state merged --json number --limit 1 --jq '.[0].number' 2>/dev/null || echo '')"
  if [[ -n "$last_pr" ]]; then
    codex_output="$(gh api "repos/$REPO_SLUG/pulls/$last_pr/comments" \
      --jq '.[] | select(.user.login | test("codex"; "i")) | "\(.path):\(.line)\n  \(.body | gsub("\n"; "\n  "))\n  url: \(.html_url)"' \
      2>/dev/null || echo '')"
    if [[ -n "$codex_output" ]]; then
      echo
      echo "--- codex comments on PR #$last_pr ---"
      echo "$codex_output"
    fi
  fi
fi

echo
echo "=== preflight complete ==="

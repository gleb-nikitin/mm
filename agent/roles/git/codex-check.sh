#!/usr/bin/env bash
set -euo pipefail

# codex-check.sh — print Codex review comments for an mm pull request.

REPO_SLUG="gleb-nikitin/mm"
die() { echo "error: $1" >&2; exit 1; }
usage() { echo "usage: codex-check.sh <pr-number|last-merged>" >&2; exit 2; }
[[ $# -eq 1 ]] || usage

command -v gh >/dev/null 2>&1 || die "gh is not installed"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"

pr="$1"
if [[ "$pr" == "last-merged" ]]; then
  pr="$(gh pr list --repo "$REPO_SLUG" --state merged --json number --limit 1 --jq '.[0].number')"
  [[ -n "$pr" ]] || die "no merged PRs found"
  echo "using last merged PR: #$pr"
fi
[[ "$pr" =~ ^[0-9]+$ ]] || die "invalid PR number: $pr"

echo "=== PR #$pr Codex comments ==="
gh api "repos/$REPO_SLUG/pulls/$pr/comments" \
  --jq '.[] | select(.user.login | test("codex"; "i")) | "\(.path):\(.line)\n  \(.body | gsub("\n"; "\n  "))\n  url: \(.html_url)\n"' \
  2>/dev/null || echo "(no Codex comments)"
echo "=== done ==="

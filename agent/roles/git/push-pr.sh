#!/usr/bin/env bash
set -euo pipefail

# push-pr.sh — publish clean local main ahead of origin/main through a PR.

REPO="${MM_GIT_REPO:-/Users/glebnikitin/work/code/mm}"
ANCHOR=".git/git-publish-anchor"

die() { echo "error: $1" >&2; exit 1; }

TOPIC=""
AUTHZ="${MM_GIT_OPERATOR_AUTHORIZED:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --operator-authorized) AUTHZ=1; shift ;;
    --topic) shift; [[ $# -gt 0 ]] || die "--topic requires a value"; TOPIC="$1"; shift ;;
    *) die "unknown arg: $1" ;;
  esac
done

if [[ "$AUTHZ" != "1" ]]; then
  cat >&2 <<'GATE'
error: push-pr requires explicit operator authorization on this turn.

Use only after u_gleb directly says to push or make a PR:
  push-pr.sh --operator-authorized [--topic <slug>]

Do not export MM_GIT_OPERATOR_AUTHORIZED; set it per invocation only.
GATE
  exit 3
fi

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"
command -v gh >/dev/null 2>&1 || die "gh is not installed"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated (run: gh auth login)"

branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == "main" ]] || die "repository must be on main (current: ${branch:-detached})"
[[ ! -f "$ANCHOR" ]] || die "an active publish cycle already exists; inspect $ANCHOR"
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty — commit or stash first"
git rev-parse --verify origin/main >/dev/null 2>&1 \
  || die "origin/main missing; use push-main-no-pr.sh only with explicit direct-push authorization"

ahead="$(git rev-list --count origin/main..HEAD)"
behind="$(git rev-list --count HEAD..origin/main)"
[[ "$behind" == "0" ]] || die "local main is $behind commit(s) behind origin/main; synchronize first"
[[ "$ahead" != "0" ]] || { echo "nothing to push (0 ahead of origin/main)"; exit 0; }

sha="$(git rev-parse --short HEAD)"
published_sha="$(git rev-parse HEAD)"
if [[ -n "$TOPIC" ]]; then
  [[ "$TOPIC" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "invalid topic slug: $TOPIC"
  branch_name="publish/$TOPIC"
else
  branch_name="publish/$sha"
fi
git show-ref --verify --quiet "refs/heads/$branch_name" && die "local branch already exists: $branch_name"
git ls-remote --exit-code --heads origin "$branch_name" >/dev/null 2>&1 && die "remote branch already exists: $branch_name"

title="$(git log -1 --pretty=%s)"
git switch --quiet -c "$branch_name"
git push --quiet -u origin "$branch_name"

if ! pr_url="$(gh pr create --base main --head "$branch_name" --title "$title" --body "")"; then
  die "branch '$branch_name' was pushed but PR creation failed"
fi

if [[ "$pr_url" =~ /pull/([0-9]+)$ ]]; then
  pr_number="${BASH_REMATCH[1]}"
else
  pr_number="$(gh pr view "$pr_url" --json number --jq '.number')"
fi
[[ -n "$pr_number" ]] || die "failed to resolve PR number from gh output"

{
  printf '%s\n' "$pr_number"
  printf '%s\n' "$published_sha"
} > "$ANCHOR"

git switch --quiet main
echo "pushed $branch_name"
echo "pr: $pr_url"
echo "pr-number: $pr_number"
echo "sha: $sha"

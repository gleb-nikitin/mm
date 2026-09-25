#!/usr/bin/env bash
set -euo pipefail

# commit-sweep.sh — safety-filtered sweep commit for mm_git.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="${MM_GIT_REPO:-$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)}"
TRAILER="Co-Authored-By: Claude <noreply@anthropic.com>"
MILESTONES="wiki/Milestones.md"

die() { echo "error: $1" >&2; exit 1; }
[[ $# -ge 1 ]] || { echo "usage: commit-sweep.sh <message>" >&2; exit 2; }
MSG="$*"

[[ -d "$REPO/.git" ]] || die "not a git repo: $REPO"
cd "$REPO"
git symbolic-ref -q HEAD >/dev/null \
  || die "refusing to commit on a detached HEAD; attach HEAD to a branch first"

exclude_reason() {
  local path="$1" base
  base="$(basename "$path")"
  [[ "$base" == ".DS_Store" ]] && echo "os-junk" && return
  [[ "$path" == .claude/* || "$path" == ".claude" || "$path" == .codex/* || "$path" == ".codex" ]] && echo "local-agent" && return
  [[ "$base" == ".env" || "$base" == .env.* ]] && echo "secret" && return
  case "$base" in *.pem|*.key|*.p12|*.pfx) echo "secret" && return ;; esac
  [[ "$path" == dist/* ]] && echo "build-artifact" && return
  [[ "$base" == '~'* || "$base" == *.swp || "$base" == *.swo ]] && echo "editor-temp" && return
  echo ""
}

included=()
excluded=()
staged_excluded=()
while IFS= read -r -d '' path; do
  reason="$(exclude_reason "$path")"
  [[ -z "$reason" ]] || staged_excluded+=("$path ($reason)")
done < <(git diff --cached --name-only -z --no-renames --)

if [[ ${#staged_excluded[@]} -gt 0 ]]; then
  echo "error: refusing sweep because excluded paths are staged:" >&2
  for entry in "${staged_excluded[@]}"; do echo "  $entry" >&2; done
  exit 1
fi

while IFS= read -r -d '' path; do
  reason="$(exclude_reason "$path")"
  if [[ -n "$reason" ]]; then excluded+=("$path ($reason)"); else included+=("$path"); fi
done < <(git diff HEAD --name-only -z --no-renames --)
while IFS= read -r -d '' path; do
  reason="$(exclude_reason "$path")"
  if [[ -n "$reason" ]]; then excluded+=("$path ($reason)"); else included+=("$path"); fi
done < <(git ls-files --others --exclude-standard -z --)

if [[ ${#included[@]} -eq 0 ]]; then
  echo "nothing to commit"
  if [[ ${#excluded[@]} -gt 0 ]]; then
    echo "excluded (${#excluded[@]}):"
    for entry in "${excluded[@]}"; do echo "  $entry"; done
  fi
  exit 0
fi

if [[ -f "$MILESTONES" ]]; then
  printf -- '- **%s**: %s\n' "$(date +%Y-%m-%d)" "$MSG" >> "$MILESTONES"
  found=0
  for file in "${included[@]}"; do [[ "$file" == "$MILESTONES" ]] && found=1; done
  [[ $found -eq 1 ]] || included+=("$MILESTONES")
fi

literal_pathspecs=()
for file in "${included[@]}"; do literal_pathspecs+=(":(literal)$file"); done
git add -A -- "${literal_pathspecs[@]}"
git commit --quiet -m "$(printf '%s\n\n%s\n' "$MSG" "$TRAILER")" -- "${literal_pathspecs[@]}"
sha="$(git rev-parse --short HEAD)"

echo "committed $sha"
echo "message: $MSG"
echo "included (${#included[@]}):"
for file in "${included[@]}"; do echo "  $file"; done
if [[ ${#excluded[@]} -gt 0 ]]; then
  echo "excluded (${#excluded[@]}):"
  for entry in "${excluded[@]}"; do echo "  $entry"; done
fi

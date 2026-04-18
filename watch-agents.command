#!/bin/zsh
# Double-click to keep the Active Agents dashboard live while you work.
# Runs all three importers every 30 seconds. Close this window to stop.
#
# Pair with run.command (starts the API) — dashboard lives at
# http://localhost:3000/active-ui.

set -u

cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "  Install from https://bun.sh or check that \$HOME/.bun/bin is populated."
  echo
  read -k 1 "?Press any key to close..."
  exit 1
fi

INTERVAL=30

echo "🔁 Watching agent sessions every ${INTERVAL}s."
echo "   Close this window to stop."
echo "   Dashboard: http://localhost:3000/active-ui"
echo

while true; do
  ts=$(date '+%H:%M:%S')
  echo "─── ${ts} ─── refreshing…"
  bun scripts/import-claude.ts --days 1 > /dev/null 2>&1 && echo "  claude ok" || echo "  claude failed"
  bun scripts/import-codex.ts  --days 1 > /dev/null 2>&1 && echo "  codex ok"  || echo "  codex failed"
  bun scripts/import-gemini.ts --days 1 > /dev/null 2>&1 && echo "  gemini ok" || echo "  gemini failed"
  sleep $INTERVAL
done

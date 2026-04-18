#!/bin/zsh
# Double-click to refresh the "Active Agents" dashboard data.
# Runs all three importers (Claude, Codex, Gemini) to update the sightings
# log in the DB. Then view live state at http://localhost:3000/active-ui
# (start run.command first if the API isn't up).

set -u

cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "  Install from https://bun.sh or check that \$HOME/.bun/bin is populated."
  echo
  echo "Press any key to close..."
  read -k 1
  exit 1
fi

echo "📥 Refreshing agent sightings (last 24h)..."
echo

echo "▸ Claude"
bun scripts/import-claude.ts --days 1 || echo "  (skipped — see error above)"
echo

echo "▸ Codex"
bun scripts/import-codex.ts  --days 1 || echo "  (skipped — see error above)"
echo

echo "▸ Gemini"
bun scripts/import-gemini.ts --days 1 || echo "  (skipped — see error above)"
echo

echo "✅ Sightings updated."
echo
echo "Dashboard: http://localhost:3000/active-ui"
echo "(If the API isn't running, double-click run.command first.)"
echo
echo "Press any key to close..."
read -k 1

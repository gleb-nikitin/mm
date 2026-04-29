#!/bin/zsh
# Double-click to (re)start the Mnemonic51 API on http://localhost:3000.
# Idempotent: kills any existing API process before starting a fresh one.
# Closing this terminal stops the server. Code edits auto-reload (--hot).

set -e

cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "  Install from https://bun.sh or check that \$HOME/.bun/bin is populated."
  echo
  read -k 1 "?Press any key to close..."
  exit 1
fi

# Kill any prior API process so double-clicking is safe.
if pkill -f "bun .*src/api.ts" 2>/dev/null; then
  echo "▸ stopped previous API process"
  sleep 0.5
fi

echo "▸ Mnemonic51 starting on http://localhost:3000 (--hot, auto-reload on edits)"
echo "  Close this window to stop the server."
echo

# Wait for the port, then open the monitor in the default browser.
( for i in {1..30}; do
    if curl -sf --max-time 1 http://localhost:3000/stats >/dev/null 2>&1; then
      open http://localhost:3000/monitor
      exit 0
    fi
    sleep 0.5
  done ) &

exec bun --hot src/api.ts

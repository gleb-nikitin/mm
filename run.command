#!/bin/zsh
# Double-click to start the Mnemonic51 API server on http://localhost:3000
# and open the UI in the default browser. Closing this Terminal window stops the server.

set -e

cd "$(dirname "$0")"

# Make sure bun + homebrew tools are on PATH when launched from Finder
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "  Install from https://bun.sh or check that \$HOME/.bun/bin is populated."
  echo
  echo "Press any key to close..."
  read -k 1
  exit 1
fi

echo "▸ Mnemonic51 starting on http://localhost:3000"
echo "  Close this window to stop the server."
echo

# Wait for the port to be listening, then open the UI in the default browser
( for i in {1..30}; do
    if curl -sf --max-time 1 http://localhost:3000/stats >/dev/null 2>&1; then
      open http://localhost:3000
      exit 0
    fi
    sleep 0.5
  done ) &

exec bun run api

#!/bin/bash
# Double-click: artifacts-only wipe (safe). Keeps raw/, wiki/, DB.
# For full wipe (raw/ + wiki/ + DB): run from terminal with `./reset-brain.command --full`.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "=== reset-brain ==="
bun scripts/reset-brain.ts "$@"
echo ""
echo "Press any key to close."
read -n 1

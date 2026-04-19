#!/bin/bash
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "=== reset-brain ==="
bun scripts/reset-brain.ts
echo ""
echo "Press any key to close."
read -n 1

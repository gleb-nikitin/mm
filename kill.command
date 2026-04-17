#!/bin/zsh
# Double-click to stop any running Mnemonic51 API server.

cd "$(dirname "$0")"

if pkill -f "bun src/api.ts"; then
  echo "✔ Mnemonic51 API stopped."
else
  echo "(nothing to stop — no Mnemonic51 API process found)"
fi

echo
echo "Press any key to close..."
read -k 1

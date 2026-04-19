#!/bin/zsh
# Double-click to launch the Librarian (Gemini) for autonomous ingestion and wiki maintenance.

set -e

cd "$(dirname "$0")"

# Ensure common paths are available
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "Press any key to close..."
  read -k 1
  exit 1
fi

echo "🧠 Handing over to the Librarian..."

# Clean start
rm -f meta/RELAUNCH_NEEDED

while true; do
  # Build the prompt dynamically
  PROMPT=$(cat <<EOF
$(cat agent/roles/lib/soul-interactive.md)

# CURRENT CONTEXT

## Handoff
$(cat agent/roles/lib/handoff.md 2>/dev/null || echo "No previous handoff.")

## Unprocessed Queue (Markdown Files)
$(bun run brain queue)

## Unprocessed Events (Chats - mm project)
$(bun run brain queue-events -p mm)

# OBJECTIVE
Perform your autonomous lifecycle: Import sessions, rebuild the index, process the queues (both files and mm events), and update your role instructions if needed.
EOF
)

  # Launch Gemini in interactive mode
  gemini -i="$PROMPT" --yolo

  # Check if a relaunch was requested
  if [[ -f meta/RELAUNCH_NEEDED ]]; then
    echo "\n🔄 Librarian requested a fresh session. Relaunching..."
    rm meta/RELAUNCH_NEEDED
    continue
  else
    break
  fi
done

echo "\n✅ Librarian has finished the shift."
echo "Press any key to close..."
read -k 1

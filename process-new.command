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

echo "📥 Step 1/3: Importing recent Claude sessions (mm, 1d)..."
bun scripts/import-claude.ts --days 1 --project mm

echo "\n🧩 Step 2/3: Chunking raw_events into raw/events/mm/*.md..."
bun scripts/chunk-events.ts --project mm

echo "\n🏗️  Step 3/3: Rebuilding index so chunks surface as raw_entries..."
bun run brain index rebuild

echo "\n🧠 Handing over to the Librarian..."

# Clean start
rm -f meta/RELAUNCH_NEEDED

while true; do
  # Build the prompt dynamically
  PROMPT=$(cat <<EOF
$(cat agent/roles/lib/soul-interactive.md)

# CURRENT CONTEXT

## Handoff
$(cat agent/roles/lib/handoff.md 2>/dev/null || echo "No previous handoff.")

## Unprocessed Queue (Markdown Files — includes event chunks under raw/events/)
$(bun run brain queue)

# OBJECTIVE
Drain the unprocessed queue. Each entry is either a document or a chat-session chunk under raw/events/<project>/. Read with \`brain read-raw <id>\`, synthesize per meta/schema.md, update the wiki with \`brain page create|update --source <id> --claim "..."\`, and mark with \`brain mark-processed <id>\`. Evolve your role docs when useful. Exit when the queue is empty or you hit ~80% context.
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

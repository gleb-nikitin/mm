#!/bin/zsh
# Double-click to launch the Librarian (Gemini) for autonomous ingestion and wiki maintenance.

set -e

cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "Press any key to close..."
  read -k 1
  exit 1
fi

# How many days back to import. Override: DAYS=30 ./process-new.command
DAYS=${DAYS:-1}

echo "📥 Step 1/4: Importing sessions (last ${DAYS}d)..."
bun scripts/import-claude.ts  --days $DAYS --project mm
bun scripts/import-codex.ts   --days $DAYS --project mm
bun scripts/import-gemini.ts  --days $DAYS --project mm

echo "\n🧩 Step 2/4: Chunking raw_events into raw/events/mm/*.md..."
bun scripts/chunk-events.ts --project mm

echo "\n🏗️  Step 3/4: Rebuilding index..."
bun run brain index rebuild

echo "\n🧠 Step 4/4: Handing over to the Librarian..."

rm -f meta/RELAUNCH_NEEDED

while true; do
  PROMPT=$(cat <<EOF
$(cat agent/roles/lib/soul-interactive.md)

# CURRENT CONTEXT

## Handoff
$(cat agent/roles/lib/handoff.md 2>/dev/null || echo "No previous handoff.")

## Unprocessed Queue (project: mm)
$(bun run brain queue --project mm)

# OBJECTIVE
Drain the unprocessed queue using the extraction protocol in meta/skills/ingest.md.
For each entry: read with \`brain read-raw <id>\`, scan all 9 extraction categories,
append findings to the relevant wiki pages, mark with \`brain mark-processed <id>\`,
log to meta/log.md. Skip chunks with no signal — do not force entries.
Exit when queue is empty or context hits ~80%.
EOF
)

  gemini -i="$PROMPT" --yolo

  if [[ -f meta/RELAUNCH_NEEDED ]]; then
    echo "\n🔄 Librarian requested a fresh session. Relaunching..."
    rm meta/RELAUNCH_NEEDED
    continue
  else
    break
  fi
done

echo "\n✅ Librarian finished. Running embed..."
bun run brain embed

echo "\nDone. Press any key to close..."
read -k 1

#!/bin/zsh
# Double-click to launch the v11 Librarian: import sessions → chunk → extract atomic artifacts.

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

echo "📥 Step 1/5: Importing sessions (last ${DAYS}d)..."
bun scripts/import-claude.ts  --days $DAYS --project mm
bun scripts/import-codex.ts   --days $DAYS --project mm
bun scripts/import-gemini.ts  --days $DAYS --project mm

echo "\n🧩 Step 2/5: Chunking raw_events into chunks_virtual (DB-only, v11)..."
bun scripts/chunk-events.ts --project mm

echo "\n💾 Step 3/5: Snapshot before Librarian run..."
bun run brain backup --target meta/brain.db.pre-librarian-bk

echo "\n🧠 Step 4/5: Handing over to the Librarian..."

rm -f meta/RELAUNCH_NEEDED

while true; do
  PROMPT=$(cat <<EOF
$(cat agent/roles/lib/soul-interactive.md)

# CURRENT CONTEXT

## Handoff
$(cat agent/roles/lib/handoff.md 2>/dev/null || echo "No previous handoff.")

## Known Artifacts (project: mm, status=active)
Before emitting, scan this list. If your candidate artifact's idempotency_key is already here, skip it (or call \`bump-correction\` for corrections). Supersede only when the chunk shows a direct contradiction.

$(bun run brain artifact keys --project mm --status active --limit 500)

## Unprocessed Chunks (project: mm)
$(bun run brain chunk queue --project mm)

# OBJECTIVE
Drain the unprocessed chunks_virtual queue using the extraction protocol in meta/skills/ingest.md.
For each chunk: \`brain chunk read <id>\`, scan artifact types, emit one
\`brain artifact batch\` call, then \`brain chunk mark-processed <id>\`.
Cross-reference the "Known Artifacts" list above to avoid re-emitting what's already there.
No wiki-page edits. No file I/O. Skip chunks with no signal.
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

echo "\n✅ Step 5/5: Librarian finished."
# NB: skipping `brain embed` — v11 artifacts aren't embedded yet and there
# should be no new wiki pages for the embedder to touch. Re-enable if/when
# artifact embedding lands.

echo "\nDone. Press any key to close..."
read -k 1

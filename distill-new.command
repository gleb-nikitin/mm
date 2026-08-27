#!/bin/zsh
# Double-click to launch the Distill librarian: import → chunk → distill into notes.
# Sibling to process-new.command. Uses meta/skills/distill.md + brain note add (no taxonomy).

set -e

cd "$(dirname "$0")"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# mm no longer guesses ac's database location. Operator scripts declare it;
# library code never falls back. Override by exporting before running.
export MT_AC_DB_PATH="${MT_AC_DB_PATH:-$HOME/Library/Application Support/com.aurora.core/data/msg.db}"

if ! command -v bun >/dev/null 2>&1; then
  echo "✗ bun not found on PATH."
  echo "Press any key to close..."
  read -k 1
  exit 1
fi

# How many days back to import. Override: DAYS=30 ./distill-new.command
DAYS=${DAYS:-1}

echo "📥 Step 1/5: Importing sessions (last ${DAYS}d)..."
bun scripts/import-claude.ts  --days $DAYS --project mm
bun scripts/import-codex.ts   --days $DAYS --project mm
bun scripts/import-gemini.ts  --days $DAYS --project mm

echo "\n🧩 Step 2/5: Chunking raw_events into chunks_virtual..."
bun scripts/chunk-events.ts --project mm

echo "\n💾 Step 3/5: Snapshot before Distill run..."
bun run brain backup --target meta/brain.db.pre-distill-bk

echo "\n🧠 Step 4/5: Handing over to the Distill librarian..."

rm -f meta/RELAUNCH_NEEDED

while true; do
  PROMPT=$(cat <<EOF
# Role: mm_lib (Distill Librarian)

You are the Distill Librarian for the mm project. Your mission: drain the chunks_virtual queue by extracting only what's worth carrying forward, per the protocol in meta/skills/distill.md.

## Skill (read this first)

$(cat meta/skills/distill.md)

# CURRENT CONTEXT

## Unprocessed Chunks (project: mm)
$(bun run brain chunk queue --project mm)

# OBJECTIVE

Drain the unprocessed chunks_virtual queue using the Distill protocol.

For each chunk:
1. \`brain chunk read <id>\`
2. Apply the value test from distill.md.
3. If the chunk has no value-test-passing content: emit no note, then \`brain chunk mark-processed <id>\`.
4. If the chunk has at least one valuable artifact: pipe \`{ source_chunk_id, summary, artifacts: [...] }\` JSON via stdin to \`brain note add\`.
   - On exit 0: \`brain chunk mark-processed <id>\`.
   - On error \`validation_no_artifacts\` or \`all_artifacts_deduped\`: \`brain chunk mark-processed <id>\` (chunk consumed; no further work).
   - On any other failure: leave chunk unprocessed for inspection. Log and continue to the next chunk.

The CLI handles title-hash dedup, schema validation, and duplicate_chunk detection. Trust the CLI errors.

No wiki-page edits. No file I/O.

Exit when queue is empty or context hits ~80%.
EOF
)

  gemini -p="$PROMPT" --yolo

  if [[ -f meta/RELAUNCH_NEEDED ]]; then
    echo "\n🔄 Distill librarian requested a fresh session. Relaunching..."
    rm meta/RELAUNCH_NEEDED
    continue
  else
    break
  fi
done

echo "\n✅ Step 5/5: Distill librarian finished."
echo "\nDone. Press any key to close..."
read -k 1

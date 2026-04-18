#!/bin/zsh
# Double-click to run the full Mnemonic51 ingestion pipeline:
# 1. Index Rebuild (Sync filesystem to SQLite)
# 2. Process (Run LLM-mediated ingest skill)
# 3. Embed (Generate vector search chunks)

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

echo "📥 Step 1/5: Previewing Claude Sessions (Dry Run)..."
bun scripts/import-claude.ts --days 1 --project mm --dry-run

echo "\n🚀 Step 2/5: Importing Claude Sessions..."
bun scripts/import-claude.ts --days 1 --project mm

echo "\n🏗️  Step 3/5: Rebuilding Index..."
bun run brain index rebuild

echo "\n📋 Step 4/5: Current Queue (Unprocessed Entries)..."
bun run brain queue

echo "\n🧠 Step 5/5: Processing Queue (Skill: ingest)..."
bun run brain process

echo "\n🛰️  Refresh: Updating Embeddings..."
bun run brain embed

echo "\n✅ Pipeline complete. Your brain is up to date."
echo "Press any key to close..."
read -k 1

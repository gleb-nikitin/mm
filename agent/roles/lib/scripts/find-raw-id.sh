#!/bin/zsh
# Usage: ./find-raw-id.sh <substring_of_path_or_title>
# Helper to find the SQLite ID for a raw entry to use in 'page create/update'

QUERY="SELECT id, title, source_path FROM raw_entries WHERE source_path LIKE '%$1%' OR title LIKE '%$1%' ORDER BY created_at DESC LIMIT 5;"
sqlite3 meta/brain.db "$QUERY"

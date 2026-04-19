---
title: Codex Session Importer
slug: Codex_Session_Importer
aliases: []
tags: [tool, codex, import]
type: concept
confidence: 0.9
mentions: 2
tier: 2
status: active
created_at: '2026-04-19T12:59:04.836Z'
updated_at: '2026-04-19T13:30:00.000Z'
source_count: 2
---

# Codex Session Importer

## Summary
The **Codex Session Importer** is a Bun/TypeScript script (`scripts/import-codex.ts`) designed to automate the ingestion of Codex chat sessions into the Mnemonic51 `raw_events` table. It mirrors the interface and contract of the [[Claude_Session_Importer|Claude Session Importer]], providing a consistent operational surface for managing LLM chat history.

## Implementation Details
The importer parses local Codex session files, which are stored as **JSONL rollout files** under `~/.codex/sessions/`. These files contain a `session_meta` record followed by a series of `response_item` and `event_msg` records.

### Key Features
- **One Row Per Session**: Landed into the `raw_events` table with `external_id` mapping to the Codex session ID.
- **Noise Filtering**: Automatically strips tool calls, mechanical records, and developer scaffolding.
- **Flattened Content**: Converts complex JSONL records into a clean `User: ...\n\nAssistant: ...` string.
- **Project Mapping**: Derives the `project` slug from the session metadata's current working directory (CWD).
- **Search Integration**: Mirroring into `events_fts` ensures sessions are immediately searchable via `brain search`.

### CLI Flags
The importer supports standard flags for incremental and filtered imports:
- `--days N`: Only sessions with mtime >= today - N (default: 30).
- `--project <substr>`: Filter by CWD substring.
- `--min-turns N`: Skip sessions with fewer than N user turns (default: 2).
- `--include-thinking`: Include assistant thinking blocks (default: off).
- `--sessions-dir <path>`: Override the default `~/.codex/sessions` path.
- `--dry-run`: List sessions found without writing to the database.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Mnemonic_Importing|Mnemonic Importing]]
- [[Claude_Session_Importer|Claude Session Importer]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-19**: Implemented `scripts/import-codex.ts` to support automated ingestion of Codex session rollouts from `~/.codex/sessions/`. The importer maps rollouts to the `raw_events` schema, strips mechanical tool-call noise, and supports incremental imports via CLI flags. Source: `event:019da0e5-a3f8-7a83-ad34-55b68f24018d`
- **2026-04-19**: Extended the Codex importer with incremental behavior using the `import_state` table and a 5-minute settled-session check, matching the Claude importer's contract. Source: `event:bafb9bad-14b7-4beb-9ef1-68ed866cc842`

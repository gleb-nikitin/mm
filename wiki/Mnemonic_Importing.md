---
title: Mnemonic Importing
slug: Mnemonic_Importing
aliases: []
tags: []
type: concept
confidence: 0.5
mentions: 1
tier: 1
status: active
created_at: '2026-04-19T12:40:42.378Z'
updated_at: '2026-04-19T12:40:42.378Z'
source_count: 1
---

# Mnemonic Importing

## Summary
Importing into Mnemonic51 follows a two-lane model: **Markdown** (manual files/notes in `raw/`) and **Agent Sessions** (automated vendor log imports into `raw_events`). Every raw entry is tagged with a `source_type` (channel) and `project` (domain slug) for scoped retrieval. Session importers (e.g., [[Claude_Session_Importer|Claude]] and [[Codex_Session_Importer|Codex]]) capture immutable history, while the `brain process` or `brain ingest-event` commands are used to synthesize that material into the wiki. Standard methods for adding entries include the HTTP `/add` endpoint, the MCP `add_to_brain` tool, and the CLI `brain add` command.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Claude_Session_Importer|Claude Session Importer]]
- [[Codex_Session_Importer|Codex Session Importer]]

---
<!-- TIMELINE: append-only below this line -->
- **2026-04-19**: Detailed the ingestion methods for sessions (Claude/Codex/Gemini) and manual entries (HTTP/MCP/CLI), emphasizing the `source_type` and `project` taxonomy for scoped retrieval. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-19**: Formalized the Codex session importer implementation, enabling automated ingestion of `.jsonl` rollout files from `~/.codex/sessions/` into the `raw_events` table. Source: `event:019da0e5-a3f8-7a83-ad34-55b68f24018d`

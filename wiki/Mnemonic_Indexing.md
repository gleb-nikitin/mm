---
title: Mnemonic Indexing
slug: Mnemonic_Indexing
aliases: []
tags: []
type: concept
confidence: 0.8
mentions: 2
tier: 1
status: active
created_at: '2026-04-19T12:40:22.298Z'
updated_at: '2026-04-19T17:20:00.000Z'
source_count: 2
---

# Mnemonic Indexing

## Summary
Indexing in Mnemonic51 synchronizes the filesystem and session events with the SQLite layer. As of v0.7.3, the 'brain process' command includes a Phase 1 Retroactive Sweep that deterministically links unprocessed raw entries to wiki pages if their paths appear in a timeline citation, backfilling claims without LLM calls. Phase 2 extends the LLM loop to accept timeline citations as valid provenance signals. Search uses dual FTS5 indices: 'search_index' for wiki/raw markdown and 'events_fts' for sessions (raw_events). Results are merged via Hybrid Search (RRF) with a reserved event lane (30%) and bag-of-words FTS normalization.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Claude_Session_Importer|Claude Session Importer]]

---

---
<!-- TIMELINE: append-only below this line -->
- **2026-04-19**: Documented detailed indexing scenarios (imported raw, Gemini wiki writes, `brain process`), command dependencies, and troubleshooting for index/embedding synchronization. Source: `raw/docs/mm/how-to-index.md`

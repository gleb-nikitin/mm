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
Indexing in Mnemonic51 synchronizes the filesystem and session events with the SQLite layer and vector chunks. Markdown on disk remains the source of truth, but derived layers must be refreshed to be searchable. The system uses two distinct FTS5 indices:
- **`search_index`**: Indices wiki pages and raw markdown entries. Used in the vector arm of hybrid search.
- **`events_fts`**: Indices automated session transcripts (`raw_events`). Used in a dedicated FTS arm.

### Hybrid Search (RRF)
Search results are merged using Reciprocal Rank Fusion (RRF). To prevent wiki pages from systematically outranking sessions (due to wiki pages appearing in both FTS and vector lists), the system implements a **reserved event lane**. This guarantees that a portion of the top results (up to 30%) are allocated to events if they match the query.

### FTS Query Normalization
To support broad matching, user queries are sanitized into a **bag-of-words** format for FTS, stripping special operators and avoiding over-strict phrase quoting. This ensures that sessions and wiki pages match based on term presence rather than verbatim sequence.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Claude_Session_Importer|Claude Session Importer]]

---
<!-- TIMELINE: append-only below this line -->
- **2026-04-19**: Documented detailed indexing scenarios (imported raw, Gemini wiki writes, `brain process`), command dependencies, and troubleshooting for index/embedding synchronization. Source: `raw/docs/mm/how-to-index.md`

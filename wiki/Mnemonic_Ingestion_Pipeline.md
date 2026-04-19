---
title: Mnemonic Ingestion Pipeline
slug: Mnemonic_Ingestion_Pipeline
aliases:
  - Ingestion Pipeline
  - MM Import
tags:
  - concept
  - architecture
type: concept
confidence: 1
mentions: 9
tier: 1
status: active
created_at: '2026-04-17T21:29:31.581Z'
updated_at: '2026-04-19T12:40:00.000Z'
source_count: 6
---

# Mnemonic Ingestion Pipeline

## Summary
The Mnemonic Ingestion Pipeline manages a data lifecycle from raw input to vector search. Since Schema v5, it follows a Dual-Root Raw architecture: 1. Documents (Markdown in raw/) and 2. Events (SQLite table raw_events). Importers (Claude, Codex, Gemini) land directly in raw_events, stripping tool noise. Schema v7 introduced import_state to enable incremental, mtime-aware imports. The pipeline steps are: 1. Ingestion (ETL to raw/ or raw_events), 2. Indexing (Sync to SQLite), 3. Processing (LLM-mediated wiki synthesis), 4. Embedding (Vector search generation). Hybrid search (RRF) combines FTS5 (for wiki and events) with Vector results.

## Cross-References
- [[Mnemonic_Light|Mnemonic Light]]
- [[Claude_Session_Importer|Claude Session Importer]]
- [[Mnemonic_Operational_Manual|Mnemonic Operational Manual]]
- [[Mnemonic_Indexing|Mnemonic Indexing]]
- [[Mnemonic_Importing|Mnemonic Importing]]

---

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Formalized the 4-step ingestion pipeline with explicit CLI commands and outlined crontab automation strategies for continuous processing. Source: `raw/claude/mm/2026-04-18T07-32-20-133Z.md`
- **2026-04-18**: Aligned the ingestion pipeline's core operations with Karpathy's 'LLM OS' model (Ingest, Query, Lint) to emphasize compiled, compounding knowledge. Source: `raw/research/mm/2026-04-18-karpathy-llm-os.md`
- **2026-04-18**: Integrated 'signal-detector' and 'media-ingest' concepts from Garry Tan's GBrain to enhance autonomous capture and broad input support. Source: `raw/research/mm/2026-04-18-gbrain.md`
- **2026-04-18**: Implemented Schema v4 with source_type and project columns to support scoped retrieval. Developed import-claude.ts to automate the ingestion of Claude session logs with project-specific tagging and text-turn extraction. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Documented standard import/process/embed workflow for managing raw material in the brain. Source: `raw/docs/mm/2026-04-17T21-35-18-150Z.md`
- **2026-04-18**: Expanded ingestion documentation to include manual methods (HTTP, MCP, CLI) and retrieval scoping via source/project filters. Source: `raw/docs/mm/2026-04-17T21-35-18-150Z.md`
- **2026-04-18**: Finalized Schema v4 with source_type/project separation and recursive indexing. Created 'agent/docs/how-to-import.md' as the canonical guide. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Formalized the 4-step data lifecycle (Ingestion, Indexing, Processing, Embedding) and documented core operational commands. Source: `raw/docs/mm/2026-04-18T07-26-51-469Z.md`
- **2026-04-18**: Planned declarative orchestration via `config.toml` and a git-backed `raw/` directory to support batch identity and session-diff processing. Source: `raw/claude/mm/2026-04-18T07-38-44-360Z.md`
- **2026-04-18**: Implemented Schema v4 with `source_type` and `project` dimensions for scoped retrieval, and defined a two-level filesystem layout. Designed a declarative orchestration layer via `config.toml`. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`
- **2026-04-19**: Finalized source-type/project taxonomy and directory layout (`raw/<type>/<project>/`). Integrated this structure into the data lifecycle (Step 2: Indexing) to ensure automated provenance derivation. Source: `raw/docs/mm/2026-04-19T12-17-11-625Z.md`
- **2026-04-19**: Defined the data model distinction between **`raw_entries`** (queue for manual notes/raw markdown) and **`raw_events`** (imported agent sessions/transcripts). Source: `raw/docs/mm/2026-04-19T12-17-11-617Z.md`
- **2026-04-19**: Mapped the 4-step data lifecycle (Ingestion, Indexing, Processing, Embedding) and documented the use of Reciprocal Rank Fusion (RRF) for hybrid search. Source: `raw/docs/mm/2026-04-19T12-17-40-817Z.md`
- **2026-04-19**: Documented detailed indexing scenarios (imported raw, Gemini wiki writes, `brain process`), command dependencies, and troubleshooting for index/embedding synchronization. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-19**: Detailed the ingestion methods for sessions (Claude/Codex/Gemini) and manual entries (HTTP/MCP/CLI), emphasizing the `source_type` and `project` taxonomy for scoped retrieval. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-19**: Implemented the Codex session importer (`scripts/import-codex.ts`) to automate the ingestion of session rollouts from `~/.codex/sessions/` into the `raw_events` table, mirroring the Claude importer's contract. Source: `event:019da0e5-a3f8-7a83-ad34-55b68f24018d`
- **2026-04-19**: Upgraded Schema to v4 with `source_type` and `project` taxonomy for scoped retrieval, planned git-aware `raw/` batch processing, and tightened the ingest skill to strictly require `meta/log.md` audits. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`
- **2026-04-19**: Implemented the "Option A" provenance fix: `brain process` now accepts Timeline citations as valid evidence, backfilling claims and marking entries processed without requiring fresh LLM calls. Introduced incremental imports with a 5-minute "settled" check for session stability. Source: `event:bafb9bad-14b7-4beb-9ef1-68ed866cc842`
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
mentions: 7
tier: 1
status: active
created_at: '2026-04-17T21:29:31.581Z'
updated_at: '2026-04-18T10:52:00.000Z'
source_count: 5
---

# Mnemonic Ingestion Pipeline

## Summary
The Mnemonic Ingestion Pipeline manages a data lifecycle from raw input to vector search. It utilizes a declarative orchestration layer via `config.toml` for scheduling and a git-backed `raw/` directory to manage batch identity and incremental diff processing. The 4-step pipeline includes: 1. Ingestion (import with source/project tags); 2. Indexing (recursive SQLite rebuild); 3. Processing (LLM Skills via `brain process`); 4. Embedding (Vector Search).

## Cross-References
- [[Mnemonic_Light|Mnemonic Light]]
- [[Claude_Session_Importer|Claude Session Importer]]
- [[GBrain|GBrain]]
- [[LLM_Wiki|LLM Wiki]]
- [[Mnemonic_Operational_Manual|Mnemonic Operational Manual]]

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

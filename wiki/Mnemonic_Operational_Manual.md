---
title: Mnemonic Operational Manual
slug: Mnemonic_Operational_Manual
aliases:
  - MM Operations
tags:
  - concept
  - operations
type: concept
confidence: 1
mentions: 6
tier: 2
status: active
created_at: '2026-04-18T10:40:00.000Z'
updated_at: '2026-04-19T17:15:00.000Z'
source_count: 5
---

# Mnemonic Operational Manual

## Summary
The Mnemonic Operational Manual provides guidance on the maintenance, automation, and troubleshooting of the Mnemonic51 system. It defines a two-lane input model: **Markdown** (manual notes/files in `raw/`) and **Agent sessions** (automated imports into `raw_events`). Knowledge ownership is strictly tiered to minimize redundancy:
- **`agent/README.md`**: Canonical reading order for developers and agents.
- **`how-mm-works.md`**: Single-page operator manual for the data lifecycle.
- **`agent/docs/roadmap.md`**: Direction, priorities, and sequence.
- **`agent/docs/todo.md`**: Brainstorm surface and aggregation of ideas.
- **`meta/schema.md`**: Canonical definition of the data model and wiki anatomy.

### 4-Step Data Lifecycle
1. **Ingestion**: Raw material enters via Markdown (`raw/`), session imports (`raw_events`), or the HTTP/MCP `/add` tools. Session imports include a "settled" check to ensure data stability.
2. **Indexing**: `bun run brain index rebuild` synchronizes the filesystem with the SQLite layer (FTS5, links, raw entries). Required after manual edits.
3. **Processing**: `bun run brain process` invokes LLM Skills to transform raw material into Compiled Truth. Direct wiki edits with Timeline citations now close the loop without LLM cost.
4. **Embedding**: `bun run brain embed` generates semantic vector embeddings via Ollama for hybrid search.

### Repository Inventory
- **`src/`**: Runtime application with a shared-logic invariant in `core.ts`.
- **`meta/`**: Brain index (`brain.db`), `schema.md`, and runtime **Instruction Markdown** (`skills/*.md`).
- **`scripts/`**: Session importers and utility scripts.
- **`wiki/` & `raw/`**: Curated knowledge and source material.
- **`agent/`**: Playbooks and development-only documentation.

### Automation & Troubleshooting
Automation is achieved via crontab tasks for session imports, queue processing, and maintenance passes. Wiki pages follow a strict anatomy: YAML frontmatter, `## Summary` (Compiled Truth), and an append-only **Timeline** citing raw source paths or event IDs.

## Cross-References
- [[Mnemonic51|Mnemonic51]]
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Mnemonic_Indexing|Mnemonic Indexing]]
- [[Mnemonic_Importing|Mnemonic Importing]]
- [[Mnemonic_Roadmap|Mnemonic Roadmap]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Established the operational manual, including automation strategies (crontab), troubleshooting procedures, and wiki page anatomy rules. Source: `raw/docs/mm/2026-04-18T07-26-51-469Z.md`
- **2026-04-19**: Defined the Data Lifecycle in three layers: Raw, Indexed, and Compiled. Mapped operational flow from ingestion to hybrid search and provided a troubleshooting table for index/embedding synchronization. Source: `raw/docs/mm/2026-04-19T12-17-11-625Z.md`
- **2026-04-19**: Defined the two-lane input model: Markdown → `raw_entries` (queue) and Agent sessions → `raw_events` (searchable/active). Source: `raw/docs/mm/2026-04-19T12-17-11-617Z.md`
- **2026-04-19**: Categorized Instruction Markdown files as "part of the product," identifying runtime prompts (`schema.md`, `skills/*.md`) and project/operator docs (`agent/`, `how-mm-works.md`). Source: `raw/docs/mm/2026-04-19T12-17-11-617Z.md`
- **2026-04-19**: Documented the full operational manual, including the 4-step data lifecycle (Ingestion, Indexing, Processing, Embedding), troubleshooting table, and crontab automation examples. Source: `raw/docs/mm/2026-04-19T12-17-40-817Z.md`
- **2026-04-19**: Documented environment variable configuration (`MT_BRAIN_ROOT`, `MT_PORT`) and noted that fresh brain roots are bootstrapped automatically on first run. Source: `raw/docs/mm/2026-04-19T12-26-57-622Z.md`
- **2026-04-19**: Finalized the Operational Manual, providing a detailed repository inventory, crontab automation templates, and a troubleshooting guide for index/embedding synchronization. Source: `raw/docs/mm/how-mm-works.md`
- **2026-04-19**: Integrated the Codex session importer into the automated ingestion toolkit, enabling scheduled capture of Codex rollouts alongside Claude and Gemini logs. Source: `event:019da0e5-a3f8-7a83-ad34-55b68f24018d`

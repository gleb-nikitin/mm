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
The Mnemonic Operational Manual defines a 4-step data lifecycle (Ingest, Index, Process, Embed) and provides a multi-lane automation toolkit. 1. process-new.command: A sequential 5-step interactive pipeline (Import -> Index -> Queue Preview -> Process -> Embed) with dry-run support. 2. Projects Discovery: CLI (brain projects) and MCP (list_projects) tools enable agents to discover and target project slugs (e.g., mm, ac, mt). 3. Automation: Crontab templates for settled-session imports and incremental indexing. The shared-logic invariant in core.ts ensures that all surfaces (CLI, API, MCP, UI) operate on the same state.

## Cross-References
- [[Mnemonic51|Mnemonic51]]
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Mnemonic_Indexing|Mnemonic Indexing]]
- [[Mnemonic_Importing|Mnemonic Importing]]
- [[Mnemonic_Roadmap|Mnemonic Roadmap]]

---

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

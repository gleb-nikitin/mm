---
title: Mnemonic51
slug: Mnemonic51
aliases: []
tags:
  - project
  - mnemonic
type: entity
confidence: 1
mentions: 7
tier: 1
status: active
created_at: '2026-04-17T23:12:27.365Z'
updated_at: '2026-04-19T17:25:00.000Z'
source_count: 7
---

# Mnemonic51

## Summary
Mnemonic51 is a project-management primitive and local-first memory engine that observes and evolves itself via a skills library. The system employs a **Dual-Root Raw** architecture to manage provenance:
1. **`raw_entries`**: A Markdown-backed queue for manual notes and durable research files stored in the `raw/` directory.
2. **`raw_events`**: A SQLite-backed store for high-volume automated session transcripts (Claude, Codex, Gemini).

This architecture separates human-curated context from automated logs, ensuring that the **Knowledge Layer** (Wiki) is synthesized from reliable sources while keeping the **Provenance Layer** (Events) searchable and findable. The system evolves by applying LLM Skills (e.g., `ingest.md`, `derive-todos.md`) to these raw inputs to produce **Compiled Truth**.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]
- [[Mnemonic_Operational_Manual|Mnemonic Operational Manual]]
- [[Claude_Session_Importer|Claude Session Importer]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Defined the Mnemonic51 roadmap, establishing the two-track plan (Light and Hardcore) and the project's purpose as a local-first memory engine. Source: `raw/docs/mm/2026-04-17T21-35-18-141Z.md`
- **2026-04-18**: Defined Mnemonic51 as a project-management primitive and mapped its internal file inventory (src, meta, scripts). Source: `raw/docs/mm/2026-04-18T07-26-51-469Z.md`
- **2026-04-18**: Reframed Mnemonic51 as a project-management primitive that observes and evolves itself via a skills library. Source: `raw/claude/mm/2026-04-18T07-38-44-360Z.md`
- **2026-04-18**: Reframed Mnemonic51 fundamentally as a project-management primitive that observes and evolves itself via its skills library, transitioning from a mere memory engine. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`
- **2026-04-19**: Clarified project architecture: strictly separate the git-managed **Codebase** from the user-managed **Brain instance**. Defined mm as a local-first brain, not a multi-tenant product. Source: `raw/docs/mm/2026-04-19T12-17-11-617Z.md`
- **2026-04-19**: Mapped repository layout, identifying `src/` for runtime, `scripts/` for utilities, `meta/` for the SQLite index and LLM skills, and `agent/` for playbooks. Source: `raw/docs/mm/2026-04-19T12-17-11-617Z.md`
- **2026-04-19**: Documented core system entrypoints: `brain.ts` (CLI), `api.ts` (HTTP/UI), `mcp.ts` (MCP tools), and `core.ts` (Engine). Defined the system as a local-first persistent knowledge base serving as a project-management primitive. Source: `raw/docs/mm/2026-04-19T12-17-11-625Z.md`
- **2026-04-19**: Formalized Mnemonic51 as a project-management primitive that uses LLM-mediated extraction to turn conversations and research into durable Markdown artifacts. Source: `raw/docs/mm/2026-04-19T12-17-40-817Z.md`
- **2026-04-19**: Documented system requirements (Bun, Gemini CLI, Ollama), configuration via `MT_BRAIN_ROOT` and `MT_PORT`, and provided an inventory of MCP tools for brain interaction. Source: `raw/docs/mm/2026-04-19T12-26-57-622Z.md`
- **2026-04-19**: Mapped the repository layout, identifying `src/` for runtime logic, `meta/` for the brain index and skills, and defined the system's "Data Model" invariants (session import vs. wiki ingest). Source: `raw/docs/mm/human-how-it-works.md`
- **2026-04-19**: Defined Mnemonic51 as a "self-reflective" project-management primitive whose value lives in the skills and ingestion practices across Knowledge, Action, and Provenance layers. Source: `raw/docs/mm/roadmap.md`
layers. Source: `raw/docs/mm/roadmap.md`
- **2026-04-19**: Reframed Mnemonic51 as a project-management primitive where the skills library (the `derive-*` family) is the core product, and the Rust migration is a deferred infrastructure step. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`

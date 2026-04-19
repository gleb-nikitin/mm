---
title: Arch Decisions
slug: arch-decisions
tags: [extracted]
type: analysis
status: active
created_at: 2026-04-20
updated_at: 2026-04-20
---

# Arch Decisions

<!-- ENTRIES: append-only below this line -->
- **2026-04-20** [mm]: Markdown on disk is the source of truth; SQLite and Vector layers are derived from it through scanning. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Separated `index rebuild` (filesystem scan) from `embed` (vector generation) to allow for fine-grained control over compute-intensive tasks. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Local-first design using Bun, SQLite, and Markdown on disk; surfaces a CLI, HTTP API, and MCP tools. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Provenance model: wiki pages cite raw paths or `event:<id>` in their Timelines to provide a verifiable chain of evidence. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Intent-based skill routing: `RESOLVER.md` maps user intent to specific LLM skills (ingest, query, lint, maintain, etc.). Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Metadata Hygiene (2026-04-18): Fields divided by compute hierarchy to minimize "Thinking Surface"; `source_count` and `mentions` to move from manual frontmatter to computed values. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Dual-Root Raw Architecture: Split between `raw/docs/` (durable markdown in Git) and `raw_events` (immutable streaming data in SQLite). Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Dedup on `external_id`: Session imports use `INSERT OR IGNORE` for safe re-runs. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Retrieval filtering: When source/project filters are set, the wiki FTS arm is skipped and only matching raw chunks participate. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Project Reframing: mm is a project-management primitive (skills + practices are the value, code is infrastructure). Source: `raw/docs/mm/roadmap.md`
- **2026-04-20** [mm]: Two-Track Plan: Track 1 (Light) in TS/Bun for methodology proof; Track 2 (Hardcore) in Rust for scaling performance. Source: `raw/docs/mm/roadmap.md`
- **2026-04-20** [mm]: Interactive Ingestion: Shift from non-interactive `gemini -p` to interactive `gemini -i` for the Librarian role to ensure higher-quality synthesis and manual oversight. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Chunk Size: ~10KB is the "Goldilocks" size for event chunks — large enough for a narrative arc, small enough to minimize "Preamble Tax" (redundant schema/skill loading). Source: `event:d4fffc2f-7dc8-4bb9-91f3-477ccb6ae707`
- **2026-04-20** [mm]: Event-Based Provenance: The `event:<id>` prefix is natively supported in Timeline citations and `ingest-event` tool, treating DB rows like filesystem markdown for provenance. Source: `event:d4fffc2f-7dc8-4bb9-91f3-477ccb6ae707`
- **2026-04-20** [mm]: Single-Session Synthesis: Preferred over multiple non-interactive subprocesses to minimize "Preamble Tax" and leverage the large context window for better synthesis. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Raw for Evidence vs Wiki for Synthesis: Mnemonic51 maintains raw logs as immutable evidence and uses the wiki for curated, distilled "Compiled Truth." Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Narrative Chunker Standards: Chunks must be turn-aligned, respect session boundaries, and target ~12KB to maximize signal-to-noise for the Librarian. Source: `event:7019409f-e485-424b-8e25-a0b1bfeffd62`
- **2026-04-20** [mm]: Orchestration Retirement: Complex multi-session orchestration (worker pools, multiplexers) is retired in favor of one Librarian session per project. Source: `event:7019409f-e485-424b-8e25-a0b1bfeffd62`

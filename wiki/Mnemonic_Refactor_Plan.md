---
title: Mnemonic Refactor Plan
slug: Mnemonic_Refactor_Plan
aliases:
  - Roadmap
  - Development Plan
tags:
  - project
  - roadmap
  - mnemonic
type: analysis
confidence: 0.9
mentions: 1
tier: 1
status: active
created_at: '2026-04-17T23:18:33.527Z'
updated_at: '2026-04-17T23:18:33.527Z'
source_count: 1
---

# Mnemonic Refactor Plan

## Summary
Mnemonic51 follows a 7-step near-term direction to evolve from Mnemonic Light (TS/Bun standalone) to Mnemonic Hardcore (Rust/Tabularium migration):
1. **Tests**: Behavior, retrieval-quality, and skill-output tests.
2. **Skills Library**: Expanding the derivation-skill family (`derive-bugs`, etc.).
3. **Refactor**: Readability pass and architectural separation.
4. **Hygiene**: Provider abstractions and briefing-based synthesis.
5. **Retrieval Quality**: Smarter chunking, reranking, and expansion.
6. **Public Polish**: Licensing, scrubbed samples, and 0.1 tag.
7. **Mnemonic Hardcore**: Migration to Rust and HNSW vector index.

### Tiered Compute Philosophy
- **Simple Jobs (Scripts)**: Deterministic ETL and normalization.
- **Stupid Jobs (Local LLMs)**: Fast, non-reasoning classification and signal detection.
- **Serious Tasks (Thinking Models)**: Deep synthesis and wiki creation.

### Metadata Hygiene
Responsibilities are split by compute tier. Fields like `source_count` and `mentions` are targeted for deprecation as manual frontmatter, to be replaced by deterministic derived metrics.

## Cross-References
- [[Mnemonic_Hardcore|Mnemonic Hardcore]]
- [[Mnemonic_Derivation_Skills|Mnemonic Derivation Skills]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Reframed the Mnemonic51 roadmap into four phases: Professionalization, Skills as the Product, Automation & UX, and Mnemonic Hardcore. Source: `raw/claude/mm/2026-04-18T07-32-20-133Z.md`
- **2026-04-18**: Defined a 5-step roadmap (Tests -> Readability -> Refactor -> Hygiene -> Retrieval) to prepare the prototype for a Rust migration and public release. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Established the Tiered Compute Philosophy (Simple/Stupid/Serious) and defined metadata hygiene responsibilities to minimize the "Thinking Surface" during synthesis. Source: `raw/docs/mm/todo.md`
- **2026-04-19**: Finalized the 7-step near-term direction, prioritizing the Skills library as the primary product and deferring Mnemonic Hardcore until the methodology is proven in Mnemonic Light. Source: `raw/docs/mm/roadmap.md`
- **2026-04-19**: Planned the Dual-Root Raw architecture (Markdown docs vs. SQLite events) and git-aware `raw/` directory for batch identity and session-diff processing. Source: `raw/docs/mm/todo.md`
- **2026-04-19**: Restructured the 7-step roadmap to prioritize the Skills Library over infrastructure changes, defining tests and eval harnesses as Step 1. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`
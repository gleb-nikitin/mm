---
title: Mnemonic Synthesis Briefing
slug: Mnemonic_Synthesis_Briefing
aliases:
  - Briefing Protocol
tags:
  - concept
  - mnemonic
  - optimization
type: concept
confidence: 0.9
mentions: 4
tier: 2
status: active
created_at: '2026-04-17T21:40:16.431Z'
updated_at: '2026-04-19T12:20:50.173Z'
source_count: 2
---

# Mnemonic Synthesis Briefing

## Summary
Mnemonic Synthesis Briefing is an optimization protocol that utilizes persistent LLM sessions pre-loaded with stable contextual preambles (briefings) to vastly reduce query latency. This pattern prevents re-injecting large systemic context (like schemas) per-query, enabling both fast interactive retrieval and batched ingestion passes.

## Cross-References
- [[Mnemonic_Light|Mnemonic Light]]

---

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Planned briefing-based synthesis (based on ac protocol) to reduce query latency by reusing persistent LLM sessions with stable preambles. Source: `raw/docs/mm/2026-04-17T21-35-18-149Z.md`
- **2026-04-18**: Adopted ac-style session resume/briefing pattern and prioritized parenthetical citations for synthesis output. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Detailed the reuse plan for ac's briefing protocol (brief.ts, sessions.ts) and established a per-page context truncation rule (~800 chars). Source: `raw/docs/mm/2026-04-17T21-35-18-149Z.md`

- **2026-04-18**: Refined synthesis briefing patterns to support batched ingestion and reduce token bloat by utilizing pre-loaded persistent LLM sessions. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`
- **2026-04-19**: Validated the briefing-based synthesis approach for ingest, demonstrating significant token savings by reusing persistent LLM sessions. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`

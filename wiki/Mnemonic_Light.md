---
title: Mnemonic Light
slug: Mnemonic_Light
aliases:
  - MM Light
tags:
  - project
  - mnemonic
type: entity
confidence: 0.9
mentions: 7
tier: 1
status: active
created_at: '2026-04-17T21:29:25.440Z'
updated_at: '2026-04-19T12:20:50.163Z'
source_count: 3
---

# Mnemonic Light

## Summary
Mnemonic Light is the TypeScript/Bun-based track of Mnemonic51, optimized for rapid iteration and packaged as an ac plugin (Holo app). It acts as the primary track where the 'skills as product' methodology is validated before any downstream Rust migration. Recent structural cleanups include a single-page Alpine.js Aurora UI, async `runGemini` execution, and a formalized 7-step roadmap prioritizing tests and skills over external dependencies.

## Cross-References
- [[Mnemonic_Hardcore|Mnemonic Hardcore]]
- [[Mnemonic_CLI|Mnemonic CLI]]
- [[Mnemonic_UI|Mnemonic UI]]
- [[LLM_Wiki|LLM Wiki]]
- [[Cross_Chat_Knowledge_Base|Cross-Chat Knowledge Base]]

---

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Defined the "Mnemonic Light" track for rapid TS/Bun iteration and ac plugin compatibility. Restructured the repository to move core logic into src/ and verified Phase 6 integration. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Formalized project purpose as a local-first memory engine with markdown as the source of truth. Source: `raw/docs/mm/2026-04-17T21-35-18-141Z.md`
- **2026-04-18**: Integrated LLM Wiki and Cross-Chat Knowledge Base research as foundational architectural patterns for Mnemonic Light. Source: `raw/research/mm/2026-04-18-karpathy-llm-os.md`, `raw/research/mm/2026-04-18-wizrag-cross-chat.md`
- **2026-04-18**: Established a six-step roadmap (Tests, Readability, Refactor, Hygiene, Retrieval, Polish) and planned provider abstractions (Ollama, Gemini, Anthropic) with streaming support. Source: `raw/docs/mm/2026-04-17T21-35-18-149Z.md`
- **2026-04-18**: Implemented 'run.command' and 'kill.command' as user-friendly entry points and clarified Mnemonic Light's role as a Holo app/ac plugin. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Completed structural cleanup: moved core logic to `src/`, verified Phase 6 integration, and established a revised 7-step roadmap. Source: `raw/claude/mm/2026-04-18T07-38-44-360Z.md`

- **2026-04-18**: Clarified Mnemonic Light as the TS/Bun track where the 'skills as product' methodology is proven before downstream migration. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`
 skills methodology is validated. Completed structural cleanup, moved core logic to `src/`, added asynchronous `runGemini`, and formalized the Aurora UI. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`

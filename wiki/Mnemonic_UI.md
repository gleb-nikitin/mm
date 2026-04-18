---
title: Mnemonic UI
slug: Mnemonic_UI
aliases:
  - MM Web UI
  - Aurora UI
tags:
  - component
  - frontend
type: entity
confidence: 0.9
mentions: 5
tier: 2
status: active
created_at: '2026-04-17T21:29:34.203Z'
updated_at: '2026-04-18T10:54:00.000Z'
source_count: 2
---

# Mnemonic UI

## Summary
The Mnemonic UI is a single-page web interface built with Alpine.js and styled with an Aurora-inspired dark glassmorphism theme. It serves as a Holo app/ac plugin component for the Mnemonic Light track. The UI features debounced search and asynchronous query handling via `Bun.spawn` to ensure a responsive, non-blocking experience. Entry points are simplified through `run.command` and `kill.command` scripts.

## Cross-References
- [[Mnemonic_Light|Mnemonic Light]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Created a single-page Alpine.js UI featuring a dark aurora theme, glassmorphism panels, and debounced search. Integrated with the API to render synthesized answers and wiki pages. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Refined UI to support async backend architecture (Bun.spawn) and increased idle timeouts for stable query delivery. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Designated the Aurora-themed web UI as a shippable ac plugin component (Holo app) for the Mnemonic Light track. Source: `raw/docs/mm/2026-04-17T21-35-18-141Z.md`
- **2026-04-18**: Optimized UI backend with asynchronous 'Bun.spawn' execution for Gemini synthesis, preventing event-loop blocking and improving stability. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Optimized the UI backend by making `runGemini` asynchronous with `Bun.spawn`, resolving event-loop blocking issues and improving frontend responsiveness. Source: `raw/claude/mm/2026-04-18T07-38-44-360Z.md`

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
mentions: 7
tier: 2
status: active
created_at: '2026-04-17T21:29:34.203Z'
updated_at: '2026-04-19T15:40:00.000Z'
source_count: 3
---

# Mnemonic UI

## Summary
The Mnemonic UI follows the 'Holo UI' design philosophy: a holographic glass interface utilizing translucent panels (backdrop-filter: blur), ghost accent buttons, and a strict 4/8px rhythm. The surface area includes: 1. Search UI (GET /) for hybrid search and synthesis, and 2. Active Agents Dashboard (GET /active-ui), a standalone polling interface that tracks live agent activity from the import_state sightings log. Typography is monospace (Monaco/Menlo) with dimmed markdown syntax markers.

## Cross-References
- [[Mnemonic_Light|Mnemonic Light]]

---

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Created a single-page Alpine.js UI featuring a dark aurora theme, glassmorphism panels, and debounced search. Integrated with the API to render synthesized answers and wiki pages. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Refined UI to support async backend architecture (Bun.spawn) and increased idle timeouts for stable query delivery. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`
- **2026-04-18**: Designated the Aurora-themed web UI as a shippable ac plugin component (Holo app) for the Mnemonic Light track. Source: `raw/docs/mm/2026-04-17T21-35-18-141Z.md`
- **2026-04-18**: Optimized UI backend with asynchronous 'Bun.spawn' execution for Gemini synthesis, preventing event-loop blocking and improving stability. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Optimized the UI backend by making `runGemini` asynchronous with `Bun.spawn`, resolving event-loop blocking issues and improving frontend responsiveness. Source: `raw/claude/mm/2026-04-18T07-38-44-360Z.md`

- **2026-04-18**: Added debounced search, async Bun.spawn execution for Gemini synthesis, and fixed idle timeouts for stable query delivery. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`
- **2026-04-19**: Documented the HTTP API surface, identifying `GET /` as the Aurora-themed web UI and mapping other functional endpoints for search, query, and validation. Source: `raw/docs/mm/2026-04-19T12-26-57-622Z.md`
mapping other functional endpoints for search, query, and validation. Source: `raw/docs/mm/2026-04-19T12-26-57-622Z.md`
- **2026-04-19**: Developed the single-page Alpine.js Aurora UI, implemented debounced search, and fixed event-loop blocking by making `runGemini` asynchronous using `Bun.spawn`. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`

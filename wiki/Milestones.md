---
title: Milestones
slug: Milestones
aliases: []
tags:
  - project
  - mnemonic
type: analysis
confidence: 1
mentions: 1
tier: 2
status: active
created_at: '2026-04-18T12:00:00.000Z'
updated_at: '2026-04-19T12:21:00.000Z'
source_count: 0
---

# Milestones

## Summary
This page tracks the architectural evolution of Mnemonic51. It is maintained by the `git` role to provide a durable trace of significant commits for synthesis context.

## Cross-References
- [[Mnemonic51|Mnemonic51]]

---
<!-- TIMELINE: append-only below this line -->
- **2026-04-17 (6a758af)**: Completed the full recursive ingest pass. Every durable subject from the initial Claude sessions is now represented in the wiki with Timeline citations. Refined the roadmap to reflect the two-track (Light/Hardcore) plan.
- **2026-04-17 (7b5f0ef)**: Landed source-separation end-to-end. Implemented Schema v4 with `source_type` and `project` columns and established the `raw/<type>/<project>/` filesystem layout.
- **2026-04-17 (ed3eaf2)**: Added the Aurora web UI (Alpine.js) and refactored `runGemini` to be async, preventing event-loop blocking during synthesis.
- **2026-04-17 (61e284e)**: Established the `mm_git` role with specialized scripts (`commit-scope.sh`, `commit-sweep.sh`, `preflight.sh`) to enforce atomic, scope-strict commits.
- **2026-04-17 (c210c1e)**: Initial structural cleanup and migration of core logic into `src/`.
- **2026-04-18**: Establish wiki/Milestones.md and automate its maintenance in git scripts
- **2026-04-18**: Final handoff update after Milestones automation
- **2026-04-18**: Land Schema v5, Dual-Root Raw architecture, and Tiered Compute Philosophy
- **2026-04-18**: Refactor process command to v0.7.3 with Phase 1 retro-sweep and Phase 2 dual-signal provenance
- **2026-04-18**: Perform documentation hygiene pass to centralize reading order and remove duplication
- **2026-04-18**: Land Schema v6 (events_fts) and rewrite Claude importer for raw_events
- **2026-04-18**: Land Schema v7 (import_state), Codex importer, and search FTS/ranking refinements
- **2026-04-18**: Add Gemini session importer
- **2026-04-18**: Add Active Agents dashboard and real-time activity tracking
- **2026-04-18**: Refine agent activity dashboard snippets to capture most recent text turn
- **2026-04-18**: Establish behavioral test suite and implement event-based provenance
- **2026-04-18**: Refine devops handoff with comprehensive session summary

# Milestones

This page tracks the architectural evolution of Mnemonic51. It is automatically maintained by the `git` role to ensure every significant commit leaves a durable trace for synthesis context.

---

<!-- MILESTONES: append-only below this line -->
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

# Agent-facing documentation

This directory is for agents (LLMs, autonomous sessions, reviewers) working on Mnemonic51, not for end users. End-user docs live in the repo root.

## Layout

- `docs/` — project-wide handoff material
  - `roadmap.md` — current direction, state, and next steps (rolling; rewritten, not appended)
  - `todo.md` — deferred refactor and release work, in dependency order
- `roles/` — per-role material for specialized agent sessions
  - each role has `soul.md` (values), `role.md` (scope and invariants), `handoff.md` (current state and next checks)

## Reading order for a fresh session

1. The relevant role's `soul.md`, `role.md`, `handoff.md` (in that order)
2. `agent/docs/roadmap.md`
3. Then code: `src/brain.ts`, `src/core.ts`, `src/api.ts`, `src/mcp.ts`, `meta/schema.md`, `meta/remaining-gaps.md`

## Rules

- Keep each role file under 50 lines; rewrite instead of appending.
- `handoff.md` is mutated every session: state, blockers, exact next checks.
- `soul.md` and `role.md` change rarely; they encode identity and scope.

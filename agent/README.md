# Agent-facing documentation

This directory is for agents (LLMs, autonomous sessions, reviewers) working on Mnemonic51, not for end users. End-user docs live in the repo root.

## Layout

- `docs/` — project-wide material
  - `roadmap.md` — committed direction: state, two-track plan, current priority order (rewritten, not appended)
  - `todo.md` — brainstorm aggregation: ideas under discussion that may become roadmap items
  - `how-to-import.md` — operational guide for bringing sources into the brain (Claude sessions, Telegram, HTTP/MCP, scoping)
  - `how-to-index.md` — post-ingest commands so new content becomes queryable (index rebuild + embed pipeline, troubleshooting)
- `roles/` — per-role material for specialized agent sessions
  - each role has at least `soul.md` (values), `role.md` (scope and invariants), `handoff.md` (current state and next checks); some roles also own `briefing.md` (mission framing) and role-local tooling

## Reading order for a fresh session

1. The relevant role's files in the order the role prescribes (typically `soul.md` → `role.md` → `handoff.md`)
2. `agent/docs/roadmap.md`
3. `how-mm-works.md` at repo root — operator manual (data lifecycle, commands, troubleshooting)
4. Code: `src/brain.ts`, `src/core.ts`, `src/api.ts`, `src/mcp.ts`; schema: `meta/schema.md`; delta tracker: `meta/remaining-gaps.md`

## Rules

- Keep each role file under 50 lines; rewrite instead of appending.
- `handoff.md` is mutated every session: state, blockers, exact next checks.
- `soul.md` and `role.md` change rarely; they encode identity and scope.

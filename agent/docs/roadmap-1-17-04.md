# Mnemonic51 Roadmap

Project:
- Name: `Mnemonic51`
- Short name: `mm`
- Repo root: `mm/`

Purpose:
- local-first memory engine
- markdown is the source of truth
- SQLite is the index, queue, and retrieval layer
- usable as both a standalone project and a plugin/integration surface

## Read First

For a fresh agent session, read in this order:
- `brain.ts`
- `core.ts`
- `api.ts`
- `mcp.ts`
- `meta/schema.md`
- `meta/remaining-gaps.md`

## Current Architecture

Primary runtime files:
- `brain.ts`: CLI entrypoint
- `core.ts`: shared runtime logic
- `api.ts`: markdown-first HTTP surface
- `mcp.ts`: MCP stdio surface

Data layout:
- `raw/`: immutable source material
- `wiki/`: maintained knowledge pages
- `meta/`: schema, skills, logs, reports, sqlite DB

Agent layout:
- `agent/docs/`: handoff and project docs for agents
- `agent/roles/`: role-specific material

## Current State

Completed phases:
- Phase 0: spine / provenance / schema groundwork
- Phase 1: page model upgrade
- Phase 2: query + save utilities
- Phase 3: deterministic lint
- Phase 4: semantic retrieval
- Phase 5: doctor / validate / dream
- Phase 6: external surface refresh, partially integrated

Important current reality:
- `core.ts` now contains shared helpers for:
  - DB bootstrap
  - path resolution
  - hybrid search
  - query / validate
  - add-to-brain
  - embed
  - stats
- `MT_BRAIN_ROOT` is the intended configuration mechanism
- `api.ts` and `mcp.ts` have active uncommitted edits and appear to be the interrupted finish pass of Phase 6

## Current Blockers

These are the first things to verify/fix in the next session:

1. Restore green typecheck.
   - Last audit found `brain.ts` using `cosine_sim` without importing it.
   - Re-run:
     - `bun x tsc --noEmit`

2. Verify the interrupted Phase 6 integration actually landed.
   - `api.ts` and `mcp.ts` were modified after the last commit.
   - Confirm they no longer shell out to `brain.ts`.
   - Confirm they both call `initDb()`.

3. Verify fresh-root bootstrap.
   - With a new temp directory and `MT_BRAIN_ROOT` set:
     - CLI works
     - API `/stats` works
     - MCP starts cleanly

4. Re-audit the public/plugin surface.
   - confirm `/stats` includes schema version
   - confirm MCP tool outputs are consistent and useful
   - confirm markdown-first HTTP behavior is stable

## Immediate Next Steps

Order for the next agent:

1. Re-run verification on the live worktree:
   - `bun x tsc --noEmit`
   - `bun run api.ts`
   - `bun run mcp.ts`
   - fresh-root test with `MT_BRAIN_ROOT`

2. If the interrupted Phase 6 fix pass is incomplete:
   - finish the integration, not a redesign
   - keep edits small and focused

3. After Phase 6 is truly stable:
   - do a cleanup pass
   - improve folder structure for a public repo
   - move docs into a cleaner public layout
   - do not broaden product scope

## Planned Cleanup After Phase 6

Do not start this until Phase 6 is committed and verified.

Main cleanup goals:
- separate public docs from historical scratch material
- improve runtime/module boundaries
- make repo shape clearer for open-source/public use
- preserve current behavior while reducing confusion

Likely direction:
- keep `brain.ts`, `api.ts`, `mcp.ts` as thin entrypoints
- keep shared logic in `core.ts` for now or split only if duplication remains
- keep `raw/`, `wiki/`, `meta/` as the brain data root
- keep `agent/` for agent-facing handoff and execution docs

## Public Repo Direction

The project is no longer a throwaway prototype.

Desired identity:
- product name: `Mnemonic51`
- short/repo working name: `mm`

Public-repo priorities:
- predictable configuration
- reliable bootstrap
- clean docs for humans and agents
- stable MCP and HTTP surfaces
- no historical planning clutter in the root

## Notes

- historical root planning docs were intentionally removed
- `agent/docs/` is now the place for handoff-focused project context
- after the next stable commit, add:
  - `agent/docs/handoff.md`
  - `agent/docs/project-map.md`
  if needed

# Handoff — mm_devops

Last updated 2026-04-17 after the structural cleanup pass + `src/` move. All changes uncommitted.

## Current state

- Phase 6 integration is committed (`4789d6f`) and verified.
- Structural cleanup + `src/` consolidation are applied to the worktree but **not yet committed**.
- Typecheck, API boot on live root, fresh-root API boot, and CLI all green.

## What this session changed

### `src/` consolidation
- Moved `brain.ts`, `core.ts`, `api.ts`, `mcp.ts` → `src/`. Relative imports (`./core.ts`) stay valid because they all moved together.
- `package.json` scripts now point at `bun src/<file>.ts`.
- Repo root now holds only config + data dirs + docs; no loose `.ts`.

### Root hygiene (earlier in this session)
- Deleted `brain.ts.bak`.
- Moved `import-chats.ts` → `scripts/import-chats.ts`.

### Gitignore + untracking
- Added runtime-generated meta reports to `.gitignore`: `doctor-report.md`, `lint-report.md`, `dream-report.md`, `index.md`, `timeline.md`, `log.md`.
- `git rm --cached` on those six files. They remain on disk; `brain.ts` commands keep writing them.

### Agent docs
- Renamed `agent/docs/roadmap-1-17-04.md` → `agent/docs/roadmap.md` and rewrote its contents.
- Added `agent/README.md`.

### Public-facing
- Added root `README.md`.
- Updated `package.json`: dropped stale `"main"` and noop test script; added `api`, `mcp`, `typecheck` scripts.

### Stale references swept
- `meta/remaining-gaps.md` no longer references deleted `plan.md` / `roadmap-2.md`.
- `meta/skills/query.md` and `meta/skills/ingest.md` now use `bun run brain ...` instead of `bun brain.ts ...`.
- `src/brain.ts` cron comment and embedded LLM prompt updated to `bun run brain ...`.
- `agent/roles/devops/role.md` scope section points at `src/*.ts`.

## Verification this session (all green)

- `bun run typecheck` → clean
- `bun run api` on live root → `/stats` returns schema v3 with real counts
- `MT_BRAIN_ROOT=<tmp>` fresh root with empty `raw/ wiki/ meta/` → API boots, `/stats` returns schema v3 with zero counts, `meta/brain.db` created
- `bun run brain queue` and `bun run brain --help` work

## Suggested commit scope

Single commit: "Structural cleanup + src/ move — root hygiene, gitignored runtime reports, public README, stable roadmap name, entrypoints in src/".

## Known deferred items (owner decisions, not devops)

- License choice.
- Scrub sample-brain content in `raw/` and `wiki/` before going public (`scripts/import-chats.ts` also has a hardcoded personal path).
- Version-tag a public 0.1.

## First recommendation for the next session

- Open with `git status` and `git diff --stat`.
- If the cleanup commit hasn't been made, make it.
- Then `bun run typecheck` + `bun run api` + fresh-root test as a smoke check.
- After that, stop unless the owner has given new scope. This repo is at a good resting point for public.

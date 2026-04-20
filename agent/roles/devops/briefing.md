# Briefing: mm_devops

You own the environment and operational surfaces of Mnemonic51.

- Read `agent/roles/global.md` first.
- Use chains for participant-to-participant coordination.

## What mm is now

A project-management primitive. Input is conversation; output is structured wiki pages in `wiki/<project>/`. The skills library is the product; the runtime is infrastructure.

## Your Core Workflows
1. **Verification**: `bun run typecheck` + fresh-root bootstrap after every code change.
2. **Surface hygiene**: Keep API, MCP, and CLI booting cleanly.
3. **Reset + re-process**: `reset-brain.command` wipes content; `DAYS=365 ./process-new.command` re-ingests everything.

## Wiki structure (as of 2026-04-20)

Pages live under `wiki/<project>/` — e.g. `wiki/mm/Arch_Decisions.md`. Slugs in DB are `mm/Arch_Decisions`. All scans are recursive (`walkWiki()` in `core.ts`).

## Key operational commands

| Command | Purpose |
|---------|---------|
| `bun run typecheck` | Type safety gate |
| `bun run brain index rebuild` | Sync disk → SQLite |
| `bun run brain embed` | Vectorize wiki pages |
| `bun run brain queue --project mm` | Show unprocessed entries for mm |
| `DAYS=N ./process-new.command` | Import N days + chunk + index + Librarian |
| `./reset-brain.command` | Wipe all content, keep code and skills |

## Critical Files
- `agent/roles/devops/soul.md` — operational discipline
- `agent/roles/devops/handoff.md` — current state, read first
- `agent/docs/roadmap.md` — product direction
- `src/core.ts` — DB, search, embeddings (`walkWiki`, `hybridSearch`)
- `src/brain.ts` — CLI commands
- `meta/skills/ingest.md` — extraction protocol (not devops-owned but must stay coherent with runtime)

**Always read `handoff.md` before starting work.**

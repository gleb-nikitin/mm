# Mnemonic51 Roadmap

Rolling roadmap. Rewrite when it drifts — don't append.

Project:
- Name: `Mnemonic51`
- Short name / repo working name: `mm`
- Purpose: local-first memory engine, markdown is the source of truth, SQLite is the index and retrieval layer, usable as both a standalone project and a plugin/integration surface (HTTP + MCP)

## Read order for a fresh session

1. `agent/README.md`
2. The role files under `agent/roles/<role>/` (soul → role → handoff)
3. This roadmap
4. `README.md` in repo root (user-facing)
5. Code: `src/brain.ts`, `src/core.ts`, `src/api.ts`, `src/mcp.ts`
6. `meta/schema.md`, `meta/remaining-gaps.md`

## Architecture

Code lives in `src/`. Data dirs sit at repo root by default but any directory with `raw/ wiki/ meta/` works via `MT_BRAIN_ROOT`.

- `src/brain.ts` — CLI (commander)
- `src/api.ts` — HTTP, markdown responses
- `src/mcp.ts` — MCP stdio server
- `src/core.ts` — shared runtime: DB bootstrap, paths, hybrid search, query, validate, add, embed, stats
- `raw/` — immutable source material
- `wiki/` — maintained knowledge pages
- `meta/` — schema, skills, sqlite, runtime reports (runtime reports are gitignored)
- `agent/` — agent-facing docs and role material
- `scripts/` — one-off utilities

## Current state

- Phase 0–5: landed and stable.
- Phase 6 (external surface refresh): committed and verified. API and MCP share `core.ts`, both call `initDb()`, no CLI shell-outs.
- Structural cleanup: landed. Root has only runtime entrypoints + config. `brain.ts.bak` deleted. `import-chats.ts` moved to `scripts/`. Runtime-generated meta reports are gitignored. `README.md` and `agent/README.md` added. `package.json` has `api`, `mcp`, `typecheck` scripts.

## Remaining known gaps

Tracked in `meta/remaining-gaps.md`. Summary:

- deterministic conflict-flagging (not yet)
- create-vs-update confidence in ingest (model-driven today)
- bulk import (one-by-one today)
- vector search may need a native SQLite extension if latency grows
- search weights are hardcoded
- no Web UI (HTTP is markdown-only — intentional for now)
- MCP follow-up actions could be richer

## Near-term direction

No feature work scheduled. Before any next feature:

- keep the CLI/API/MCP surfaces stable
- keep bootstrap reliable on fresh `MT_BRAIN_ROOT`
- keep `core.ts` as the single source of shared logic

## Public repo direction

Mnemonic51 is set up as a public-style project:

- stable entrypoint names
- README at root
- `agent/` strictly for agent material
- runtime-generated reports out of version control

What's still an owner decision, not a devops one:

- license selection
- whether to scrub the sample brain content (`raw/`, `wiki/`) before going public
- whether to version-tag a public 0.1

# AGENTS.md

This file applies to the entire repository.

## Purpose
- `mm` is Mnemonic51: a local-first persistent knowledge base.
- Markdown on disk is the source of truth; SQLite is the index and retrieval layer.
- Main surfaces: CLI (`bun run brain`), HTTP/UI (`bun run api`), and MCP (`bun run mcp`).

## First Reads
- Start with `README.md` for the quick overview.
- Read `human-how-it-works.md` for the repository map, data flow, and authoritative file-level guidance.
- Read `agent/README.md` for agent-facing docs and session reading order.
- Read `agent/STANDARDS.md` before making non-trivial changes.

## Working Rules
- Keep changes minimal and aligned with the current architecture.
- Prefer fixing root causes over adding one-off patches.
- Do not append sprawling notes; rewrite docs in place when keeping durable state.
- Preserve provenance-oriented behavior and terminology already used in the project.
- Treat `src/` as authoritative if docs and code disagree.

## Code Map
- `src/brain.ts` — CLI entrypoint.
- `src/api.ts` — HTTP API and static UI.
- `src/mcp.ts` — MCP stdio server.
- `src/core.ts` — shared runtime logic, DB, search, LLM, embeddings.
- `scripts/` — importers, chunking, one-off utilities.
- `tests/behavior.test.ts` — integration coverage.
- `ui/` — static frontend assets.
- `raw/`, `wiki/`, `meta/` — brain instance data rooted at `MT_BRAIN_ROOT`.

## Commands
- Install deps: `bun install`
- Typecheck: `bun run typecheck`
- Tests: `bun test`
- CLI: `bun run brain`
- API/UI: `bun run api`
- MCP: `bun run mcp`

## Agent Expectations
- For substantial repo work, use a short plan and keep it updated.
- Read large files in chunks and prefer targeted searches with `rg`.
- Validate changes with the narrowest relevant command before broader checks.
- Do not fix unrelated failures unless explicitly asked.

## Documentation Expectations
- Keep agent docs concise and operational.
- Prefer durable updates to existing docs over creating redundant new files.
- When touching agent workflows or project behavior, update the relevant doc alongside code.

## Notes
- External runtime expectations include Bun, Gemini CLI, and optionally Ollama for embeddings.
- `MT_BRAIN_ROOT` changes where `raw/`, `wiki/`, and `meta/` live; when unset, cwd is used.

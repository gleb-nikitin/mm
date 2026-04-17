# Mnemonic51

Local-first persistent knowledge base. Markdown is the source of truth; SQLite is the index, queue, and retrieval layer. Usable as a standalone tool and as a plugin surface via HTTP or MCP.

Short name: `mm`.

## Layout

- `src/brain.ts` — CLI entrypoint (commander-based, the main way you drive the brain)
- `src/api.ts` — HTTP surface (markdown-first endpoints)
- `src/mcp.ts` — MCP stdio surface (for MCP-capable clients)
- `src/core.ts` — shared runtime logic used by all three entrypoints
- `raw/` — immutable source material (one markdown file per snippet)
- `wiki/` — maintained knowledge pages
- `meta/` — schema, skills, sqlite DB, runtime reports
- `agent/` — documentation for agents working on this codebase (see `agent/README.md`)
- `scripts/` — one-off utilities, not runtime entrypoints

## Requirements

- [Bun](https://bun.sh) 1.1+
- [Ollama](https://ollama.com) running at `localhost:11434` for embeddings and synthesis

## Quick start

```sh
bun install
bun run typecheck
bun run brain -- queue    # list pending raw entries
bun run api               # HTTP API on :3000
bun run mcp               # MCP stdio server
```

## Configuration

Set `MT_BRAIN_ROOT` to point at any directory with `raw/ wiki/ meta/`. If unset, the current working directory is used. Fresh roots are bootstrapped automatically on first run.

```sh
MT_BRAIN_ROOT=~/my-brain bun run api
```

## HTTP API

All responses are markdown.

- `GET /` — endpoint list
- `GET /stats` — brain health and schema version
- `GET /search?q=...` — hybrid search (FTS5 + vector)
- `GET /query?q=...` — synthesized answer with citations
- `GET /validate?q=...` — fact-check a specific claim
- `GET /wiki/:slug` — read a wiki page
- `POST /add` with `{ content, title }` — ingest a raw snippet

## MCP tools

`search_brain`, `query_brain`, `add_to_brain`, `validate_claim`, `brain_stats`, `embed_brain`.

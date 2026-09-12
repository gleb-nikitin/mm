# Mnemonic51

Local-first persistent knowledge base. Markdown is the source of truth; SQLite is the index, queue, and retrieval layer. Usable as a standalone tool and as a plugin surface via HTTP or MCP.

Short name: `mm`.

**Project entry (layout, data flow, every `.ts` file, configuration):** [`human-how-it-works.md`](human-how-it-works.md)

## Layout

- `src/brain.ts` — CLI entrypoint (commander-based, the main way you drive the brain)
- `src/api.ts` — HTTP server + static UI under `ui/`
- `src/mcp.ts` — MCP stdio surface (for MCP-capable clients)
- `src/core.ts` — shared runtime logic used by all three entrypoints
- `raw/` — immutable source material (markdown; queued as `raw_entries`)
- `wiki/` — maintained knowledge pages
- `meta/` — schema, skills (LLM instructions), sqlite DB, runtime reports — see [`human-how-it-works.md`](human-how-it-works.md) §2.3
- `agent/` — documentation for agents working on this codebase (see [`agent/README.md`](agent/README.md))
- `scripts/` — importers and one-off utilities

## Requirements

- [Bun](https://bun.sh) 1.1+
- **Gemini CLI** — `gemini` on `PATH` (see your environment’s install docs) — used by `brain process`, `brain query`, `brain validate`, `brain ingest-event` (see `src/core.ts`)
- [Ollama](https://ollama.com) at `localhost:11434` — embeddings (`nomic-embed-text`) for `brain embed` and the vector arm of hybrid search

## Quick start

```sh
bun install
bun run typecheck
bun run brain -- queue    # list pending raw entries
bun run api               # HTTP API + UI on :3000 (override with MT_PORT)
bun run mcp               # MCP stdio server
```

## Configuration

Set `MT_BRAIN_ROOT` to point at any directory with `raw/`, `wiki/`, and `meta/`. If unset, the current working directory is used. Fresh roots are bootstrapped automatically on first run.

```sh
MT_BRAIN_ROOT=~/my-brain bun run api
```

`MT_PORT` sets the HTTP port for `bun run api` (default **3000**).

`MT_AC_DB_PATH` must point to Aurora's `msg.db` for participant/session linking
when mm runs outside the Aurora supervisor. The plugin manifest supplies it to
managed API and watcher processes as `$AURORA_DATA/data/msg.db`; standalone
importers and MCP/API processes must receive it explicitly.

## HTTP API

Responses are mostly **markdown**. **`GET /`** serves the **web UI** (`ui/index.html`). For a markdown list of routes, use **`GET /help`**.

- `GET /help` — endpoint list (markdown)
- `GET /` — web UI (Aurora-themed index)
- `GET /monitor` — Active Agents + R1 Monitor HTML view
- `GET /stats` — brain health and schema version
- `GET /search?q=...` — hybrid search (FTS5 + vector + events); optional `source` / `project` filters
- `GET /query?q=...` — synthesized answer with citations
- `GET /validate?q=...` — fact-check a specific claim
- `GET /wiki/:slug` — read a wiki page
- `GET /active` — active agents (markdown)
- `GET /api/v1/sessions/active` — JSON session tracker view over `session_index`
- `GET /api/v1/sessions/events?since_id=...` — SSE session lifecycle event stream
- `GET /api/v1/cost/by-session?session_id=...&vendor=...` — JSON token/cost attribution for a session
- `GET /api/v1/cost/by-message?chain_msg_id=...` — JSON token/cost attribution through a prompt-footer message link
- `POST /add` with `{ content, title, source_type?, project? }` — ingest a raw snippet

## MCP tools

`search_brain`, `query_brain`, `add_to_brain`, `validate_claim`, `brain_stats`, `list_projects`, `list_active_agents`, `embed_brain`.

## More documentation

| Doc | Purpose |
|-----|---------|
| [`human-how-it-works.md`](human-how-it-works.md) | **Start here** — repository map, **`chunk-events`**, Librarian **`process-new.command`**, instruction files |
| [`how-mm-works.md`](how-mm-works.md) | Operator manual (lifecycle, cron ideas, troubleshooting) |
| [`agent/docs/how-to-import.md`](agent/docs/how-to-import.md) | Importing, scoping, **`raw_events`** vs **`raw/events/`** |
| [`agent/docs/how-to-index.md`](agent/docs/how-to-index.md) | Index rebuild vs embed |

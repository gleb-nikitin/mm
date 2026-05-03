# How to import into the brain

See also: **[`human-how-it-works.md`](../../human-how-it-works.md)** (full map: **`raw/`**, **`raw_events`**, **`raw/events/`** chunks, importers, Librarian **`process-new.command`**), **[`how-to-index.md`](how-to-index.md)** (rebuild SQLite and embeddings after changes).

Every raw markdown file is tagged with two orthogonal fields:

- **`source_type`** (channel): `claude`, `telegram`, `chains`, `docs`, `research`, `knowledge`. Legacy / hand-added defaults to `raw`.
- **`project`** (domain slug): e.g. `mm`, `ac`, `claude-usage`, `personal`.

Files live under `raw/<source_type>/<project>/<timestamp>.md`. Filters at query time (`?source=…&project=…`) narrow retrieval to matching raw chunks.

## Importing Claude Code, Codex, and Gemini sessions

The current session importers — **`scripts/import-claude.ts`**, **`import-codex.ts`**, **`import-gemini.ts`** — read JSONL/JSON under the vendor’s app directories (`~/.claude/projects`, `~/.codex/sessions`, `~/.gemini/tmp`, …). They insert **one row per session** into **`raw_events`** and **`events_fts`**, and update **`import_state`** for the Active Agents dashboard. They **do not** write markdown under `raw/claude/...` by default.

```sh
# Default: last 30 days, min user turns, no thinking blocks, etc.
bun scripts/import-claude.ts

# Narrow + dry-run first (recommended)
bun scripts/import-claude.ts --days 14 --project "work/code/mm" --dry-run

# Real import
bun scripts/import-claude.ts --days 14 --project mm
```

Flags (Claude script; Codex/Gemini have analogous flags — `--help` on each):

- `--days N` — only files with mtime ≥ today − N (default: 30).
- `--project <substr>` — substring match on cwd (Claude/Codex) or project path (Gemini).
- `--min-turns N` — skip sessions with fewer user turns.
- `--include-thinking` — include assistant thinking blocks (default: off).
- `--dry-run` — list what would import, write nothing.

**Chunking sessions into normal raw files:** run **`bun scripts/chunk-events.ts`** (optionally **`--project mm`**). That writes turn-aligned markdown under **`raw/events/<project>/`**, sets **`raw_events.chunked=1`**, and lets **`brain index rebuild`** create **`raw_entries`** with `source_type=events` so **`brain process`** (or the **Librarian** in **`process-new.command`**) can ingest them like any other raw file.

**Turning a single session into the wiki without chunking:** **`brain ingest-event <external_id>`** (Gemini + timeline `event:…` citation). Session rows are also **searchable immediately** via hybrid search’s event lane.

Rerunning imports uses **`INSERT OR IGNORE`** / dedup on **`external_id`** — safe to repeat.

## Importing Telegram chats

Route Telegram chat imports through **`addToBrain`** with `{ sourceType: 'telegram', project: '<chat-slug>' }` so files land under `raw/telegram/<project>/`. See **`meta/skills/import-chat.md`** for the intended slice-and-write pattern.

## Adding single entries manually

### Via HTTP

```sh
curl -X POST -H 'Content-Type: application/json' \
  -d '{"content":"...","title":"meeting notes","source_type":"docs","project":"mm"}' \
  http://localhost:3000/add
```

Omitting `source_type` / `project` defaults to `raw` / `unknown` (see `core.ts::addToBrain`).

### Via MCP

Tool `add_to_brain` accepts `content`, optional `title`, optional `source_type`, optional `project`. Same defaults.

### Via CLI

```sh
bun run brain add "your content here" --title "optional title"
```

CLI `add` does not expose `--source` / `--project` flags; move the file under `raw/<source>/<project>/` after the fact if needed, then **`brain index rebuild`**.

## After adding raw markdown

Once **`raw_entries`** exist on disk (and the index knows about them):

```sh
bun run brain queue       # list unprocessed entries
bun run brain process     # ingest LLM pass (Gemini + meta/skills/ingest.md)
bun run brain embed       # (re-)generate vector embeddings for wiki pages
```

`brain index rebuild` walks `raw/` and re-stamps `source_type` / `project` from the path.

## Scoping retrieval after import

```sh
curl 'http://localhost:3000/search?q=hiking&source=claude&project=mm'
curl 'http://localhost:3000/query?q=what+did+we+do&source=claude,chains&project=mm'
```

When either filter is set, the wiki FTS arm is skipped — only raw-owned vector chunks participate for that arm (see `core.ts::hybridSearch`). Wiki pages remain project-agnostic compiled truth.

## Adding a new source_type

Pass a new string to `addToBrain` — the taxonomy is freeform in code. Keep **`meta/schema.md`** aligned so prompts match reality.

## Pipeline mental model

Markdown on disk is canonical; **SQLite** and **vector chunks** are derived. After edits outside **`brain process`** / **`dream`**, run **`brain index rebuild`** (and usually **`brain embed`** for wiki changes). Full tables and habits: **[`how-to-index.md`](how-to-index.md)**.

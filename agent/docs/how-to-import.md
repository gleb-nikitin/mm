# How to import into the brain

Every raw entry is tagged with two orthogonal fields:

- **`source_type`** (channel): `claude`, `telegram`, `chains`, `docs`, `research`, `knowledge`. Legacy / hand-added defaults to `raw`.
- **`project`** (domain slug): e.g. `mm`, `ac`, `claude-usage`, `personal`.

Files live under `raw/<source_type>/<project>/<timestamp>.md`. Filters at query time (`?source=…&project=…`) narrow retrieval to matching raw chunks.

## Importing Claude Code sessions

The `scripts/import-claude.ts` walks `~/.claude/projects/*.jsonl`, normalizes user + assistant turns, writes one markdown file per session.

```sh
# Default: last 30 days, min 2 user turns, no thinking blocks, no filter
bun scripts/import-claude.ts

# Narrow + dry-run first (recommended)
bun scripts/import-claude.ts --days 14 --project "work/code" --dry-run

# Real import
bun scripts/import-claude.ts --days 14 --project mm
```

Flags:

- `--days N` — only sessions with mtime ≥ today − N (default: 30).
- `--project <substr>` — substring match on decoded cwd. `mm` matches `/Users/you/work/code/mm`.
- `--min-turns N` — skip sessions with fewer user turns (default: 2). Filters out trivial tool-only runs.
- `--include-thinking` — include assistant thinking blocks (default: off).
- `--dry-run` — list what would import, write nothing.

Per session → one file in `raw/claude/<project-basename>/`. Project slug is the last component of the session's `cwd` (e.g. `mm`, `ac`). Tool uses collapse to `[tool: <name>]`; tool results are skipped (noisy, usually duplicate source material).

Content-hash dedup via `core.ts::addToBrain` — rerunning with the same scope is safe.

## Importing Telegram chats

`scripts/import-chats.ts` is the legacy Telegram importer. It still uses raw SQL and writes to `raw/` without the new source_type/project tagging. Before using it for a real import, update the final write to go through `addToBrain(…, { sourceType: 'telegram', project: '<chat-slug>' })` so entries land under `raw/telegram/<chat>/`.

## Adding single entries manually

### Via HTTP

```sh
curl -X POST -H 'Content-Type: application/json' \
  -d '{"content":"...","title":"meeting notes","source_type":"docs","project":"mm"}' \
  http://localhost:3000/add
```

Omitting `source_type` / `project` writes to `raw/raw/unknown/`.

### Via MCP

Tool `add_to_brain` accepts `content`, optional `title`, optional `source_type`, optional `project`. Same defaults.

### Via CLI

```sh
bun run brain add "your content here" --title "optional title"
```

CLI does not currently expose source/project flags — if you're adding via CLI, move the file into the right `raw/<source>/<project>/` folder afterward and run `bun run brain queue` to re-index.

## After importing

Once raw entries are on disk:

```sh
bun run brain queue       # list unprocessed entries
bun run brain process     # run the ingest LLM pass (turns raw into wiki updates)
bun run brain embed       # (re-)generate vector embeddings
```

The rebuild-index step inside those commands walks `raw/` recursively and re-stamps `source_type` / `project` from the filesystem path. Moving files between `raw/<source>/<project>/` folders is safe — next index rebuild picks up the new location.

## Scoping retrieval after import

All search and query endpoints accept the filter params:

```sh
# HTTP
curl 'http://localhost:3000/search?q=hiking&source=claude&project=mm'
curl 'http://localhost:3000/query?q=what+did+we+do&source=claude,chains&project=mm'

# MCP
search_brain({ query: "hiking", source_types: ["claude"], projects: ["mm"] })
query_brain({ question: "what did we do", source_types: ["claude","chains"], projects: ["mm"] })
```

When either filter is set, the wiki FTS arm is skipped — only raw-entry vector chunks participate. Wiki pages are compiled truth and intentionally project-agnostic, so they don't carry a single source/project.

## Adding a new source_type

Just pass a new string to `addToBrain` — the taxonomy is freeform in code (no enum). Keep the canonical list in `meta/schema.md` in sync so the synthesis prompt reflects reality.

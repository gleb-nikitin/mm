# How Mnemonic51 (`mm`) Works: Operational Manual

**See first:** **[`human-how-it-works.md`](human-how-it-works.md)** — codebase map, **`raw_events`** vs **`raw/`**, every entrypoint, and **`meta/`** instruction files (what each tells an LLM).

Mnemonic51 is a local-first persistent knowledge base that serves as a **project-management primitive**. It uses LLM-mediated extraction (Skills) to turn conversation and research into durable Markdown artifacts.

---

## 1. The Data Lifecycle (Operational Flow)

Data flows through three distinct layers: **Raw**, **Indexed**, and **Compiled**.

### Step 1: Ingestion (Importing Data)
Data enters via overlapping paths:

- **Markdown → `raw/`** — `POST /add`, `bun run brain add`, or files under `raw/<source_type>/<project>/`. These become **`raw_entries`** when indexed.
- **Claude / Codex / Gemini sessions** — `bun scripts/import-claude.ts` (and the Codex/Gemini scripts) read vendor logs and insert rows into **`raw_events`** + **`events_fts`** (searchable; Active Agents via **`import_state`**). They do **not** by default write session text as files under `raw/claude/...`. To fold a session into the wiki, use **`brain ingest-event <external_id>`** or a manual export workflow.
- **HTTP API**: `POST /add` with `{content, title, source_type, project}` for structured raw capture.
- **Manual/CLI**: `bun run brain add "some text" --title "My Note"`.

### Step 2: Indexing (The SQLite Layer)
New files in `raw/` are just text until indexed.
- **Command**: `bun run brain index rebuild`
- **What happens**: Scans the filesystem. Upserts rows into the `raw_entries` and `wiki_pages` tables. Updates the Full-Text Search (FTS5) index.
- **Provenance**: The system derives `source_type` and `project` from the folder structure (e.g., `raw/docs/mm/` → source: `docs`, project: `mm`).

### Step 3: Processing (The Ingest Skill)
This is where the "intelligence" happens.
- **Command**: `bun run brain process`
- **Mechanism**: Iterates over entries in `raw_entries` where `processed = 0`. For each entry, it calls the LLM with the `meta/skills/ingest.md` prompt.
- **Outcome**: The LLM decides whether to **Create** a new wiki page or **Update** an existing one. It rewrites the "Summary" (Compiled Truth) and appends a citation to the "Timeline."

### Step 4: Embedding (Vector Search)
To enable semantic "meaning-based" search, the wiki content must be vectorized.
- **Command**: `bun run brain embed`
- **Mechanism**: Splits wiki pages into chunks (Truth chunks and Timeline chunks) and generates embeddings via Ollama.
- **Search**: `/search` uses **Reciprocal Rank Fusion (RRF)** to combine FTS5 results and Vector results.

---

## 2. File Inventory (What does what?)

### Entrypoints (`src/`)
- `brain.ts`: The CLI controller. Handles all `bun run brain` commands (process, index, embed, query).
- `api.ts`: The HTTP server. Serves the Aurora web UI and provides the Markdown-first API.
- `mcp.ts`: The Model Context Protocol server. Allows Claude/Cline to use MM as a set of tools.
- `core.ts`: The "Engine." Contains the database schema, LLM orchestration logic, hybrid search implementation, and embedding logic.

### Data & Meta (`meta/`)
- `brain.db`: The SQLite database. Stores the index, provenance links, and job state.
- `schema.md`: The canonical definition of the brain's data model.
- `skills/`: The "Software" of the system. Markdown files that define how the LLM should process data.
- `log.md`: An append-only audit trail of every ingest and update.

### Scripts (`scripts/`)
- `import-claude.ts` / `import-codex.ts` / `import-gemini.ts`: Session importers → **`raw_events`** (not `raw/` markdown by default).
- `import-chats.ts`: Legacy Telegram one-off → flat **`raw/`** + SQL.
- `ingest-manual.ts`: Optional ingest of **`how-mm-works.md`** via `addToBrain`.

---

## 3. Automation (Cron Jobs)

To make MM a "living" system, you should automate the import and processing steps.

### Example Crontab (`crontab -e`)
```bash
# 1. Import new Claude sessions every hour
0 * * * * cd /path/to/mm && /usr/local/bin/bun scripts/import-claude.ts --days 1 --project mm >> meta/import.log 2>&1

# 2. Process the queue (Ingest Skill) every 2 hours
0 */2 * * * cd /path/to/mm && /usr/local/bin/bun run brain process >> meta/process.log 2>&1

# 3. Refresh embeddings and Timeline daily at 3 AM
0 3 * * * cd /path/to/mm && /usr/local/bin/bun run brain embed && /usr/local/bin/bun run brain timeline >> meta/maintenance.log 2>&1

# 4. Weekly "Dream" (Full maintenance + LLM-assisted merge)
0 4 * * 0 cd /path/to/mm && /usr/local/bin/bun run brain dream >> meta/dream.log 2>&1
```

---

## 4. Operational Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| File on disk but not in search | SQLite index is stale | `bun run brain index rebuild` |
| Search works, but `/query` doesn't cite it | Embeddings are missing | `bun run brain embed` |
| "Page not found" in `brain process` | Broken link or missing index | `bun run brain index rebuild` |
| `brain process` loops on same file | Log write failed | Check if `meta/log.md` is writable and the LLM output is valid. |

---

## 5. Wiki Page Anatomy

Canonical definition lives in `meta/schema.md`. In short: YAML frontmatter, `## Summary` (Compiled Truth), then `---` and `<!-- TIMELINE: append-only below this line -->` marking an append-only evidence log. Never edit or delete timeline bullets; every bullet must cite its raw source path.

---

## 6. Current State

- **Stable Substrate**: The TypeScript/Bun runtime with SQLite indexing is fully operational.
- **Taxonomy Landed**: Support for source-separated storage (`raw/<source>/<project>`) and filtered retrieval is active.
- **Primary Skills**: `ingest` and `derive-todos` are implemented and being used to self-evolve the project.
- **Search Quality**: Hybrid search is functional, though currently bottlenecked by full-page context injection in queries.
- **Connectivity**: Fully accessible via CLI, HTTP API, and MCP tools (`search_brain`, `query_brain`, `add_to_brain`).

---

## 7. Direction & Roadmap

Current direction, priority order, and the two-track plan (Mnemonic Light → Mnemonic Hardcore) live in `agent/docs/roadmap.md`. Loose ideas and proposals not yet committed to a sequence live in `agent/docs/todo.md`.

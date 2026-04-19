---
title: How It Works Now
slug: how-it-works-now
tags: [extracted]
type: analysis
status: active
created_at: 2026-04-20
updated_at: 2026-04-20
---

# How It Works Now

<!-- ENTRIES: append-only below this line -->
- **2026-04-20** [mm]: Derived layers (SQLite and Vector chunks) must be refreshed when the disk changes. SQLite tables are rebuilt via scanning the filesystem, while vector chunks are generated from wiki pages. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Order of indexing matters: `index rebuild` must run before `embed` as the latter reads from the SQLite `wiki_pages` table. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Three scenarios for indexing: manual rebuild after raw import/wiki edit, or automatic rebuild when using `bun run brain process`. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Project structure: `src/` (runtime), `scripts/` (importers/chunkers), `meta/` (DB/skills), `wiki/` (curated knowledge), `raw/` (incoming data). Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Data model: `raw_entries` (files in `raw/`), `raw_events` (agent sessions), `wiki_pages` (curated content), `chunks` (vector embeddings). Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Two input lanes: Markdown files to `raw_entries` and agent sessions to `raw_events`. Ingestion chain: Import -> Chunk -> Rebuild -> Process -> Embed. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Schema v10 includes `raw_events.chunked` to track which sessions have been converted to markdown chunks. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Tiered Compute Philosophy: Simple Jobs (Scripts/TS), Stupid Jobs (Local LLMs for classification/routing), and Serious Tasks (Thinking Models like Gemini Pro for synthesis). Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Metadata responsibility split: Lib (High Reasoning) handles slug/title/summary/links; Local LLM (Classification) handles type/tags/initial tier; Scripts (Deterministic) handle source_count/mentions/dates. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Freeform taxonomy: Every raw markdown file is tagged with `source_type` (e.g., `claude`, `telegram`) and `project` (domain slug). Files are stored under `raw/<source_type>/<project>/<timestamp>.md`. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Session importers (`scripts/import-claude.ts`, etc.) insert one row per session into `raw_events` and `events_fts`, deduping by `external_id`. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: `scripts/chunk-events.ts` converts sessions into turn-aligned markdown chunks under `raw/events/<project>/` for ingestion. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Interactive Librarian flow (`process-new.command`): Imports sessions, chunks events, rebuilds index, then launches an interactive Gemini session (`gemini -i`) for high-quality ingestion and synthesis. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Context management: The Librarian checks for "context saturation" and can signal a handoff to a fresh session via `meta/RELAUNCH_NEEDED`. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Narrative Chunker strategy: To reduce "Preamble Tax" (re-reading schema/skills) and improve context, agent sessions are grouped by project and chunked into ~10KB markdown files under `raw/events/<project>/`. Source: `event:d4fffc2f-7dc8-4bb9-91f3-477ccb6ae707`
- **2026-04-20** [mm]: DB-to-File Sync: SQLite `raw_events` table serves as "Hot" storage for fast filtering/dedup, while `raw/events/` markdown files serve as "Cold" storage for human legibility and Git-backed truth. Source: `event:d4fffc2f-7dc8-4bb9-91f3-477ccb6ae707`
- **2026-04-20** [mm]: Direct Event Synthesis: The Librarian personally synthesizes information from chat events in a single session, avoiding the overhead of spawning sub-processes for each event. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Event-related CLI commands: `queue-events` (with project filter), `read-event`, and `mark-event-processed` support the interactive Librarian workflow. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: `process-new.command` is a thin wrapper that launches the interactive Librarian session and manages the `RELAUNCH_NEEDED` loop. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Incremental Re-processing: The indexer detects content changes (via hash) in previously processed files and automatically resets them to `processed=0` so the Librarian sees them again. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: `run.command`: Double-click shortcut to launch the API server (`bun run api`) and automatically open the UI in the default browser. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Narrative Chunker implementation (`scripts/chunk-events.ts`): Groups `raw_events` by project and session, splitting at turn boundaries into ~12KB chunks. Idempotent and supports dry-runs. Source: `event:7019409f-e485-424b-8e25-a0b1bfeffd62`
- **2026-04-20** [mm]: Orchestration simplification: High context efficiency (8% for 35 chunks) allows one Librarian session to process an entire project's worth of logs, retiring complex multi-session orchestration plans. Source: `event:7019409f-e485-424b-8e25-a0b1bfeffd62`
- **2026-04-20** [mm]: Three-layer architecture: Knowledge layer (`wiki/`), Action layer (`agent/docs/*.md`), and Provenance layer (`raw/` + `claims` table). Source: `raw/docs/mm/roadmap.md`
- **2026-04-20** [mm]: Self-reflective projects: sessions produce raw data, which is ingested into the wiki and used by derivation skills to propose next actions for the project. Source: `raw/docs/mm/roadmap.md`

---
title: Claude Session Importer
slug: Claude_Session_Importer
aliases:
  - import-claude.ts
tags:
  - concept
  - mnemonic
  - importer
type: concept
confidence: 0.9
mentions: 6
tier: 2
status: active
created_at: '2026-04-17T21:40:16.402Z'
updated_at: '2026-04-19T14:10:00.000Z'
source_count: 4
---

# Claude Session Importer

## Summary
A TypeScript script (`scripts/import-claude.ts`) that normalizes and ingests Claude session transcripts into the **`raw_events`** SQLite table (and `events_fts` index) rather than the `raw/` filesystem by default. It natively parses JSONL logs, filters by project/turns/date, deduplicates via content hash, and automatically tags ingested entries with appropriate `source_type` and `project` dimensions. To fold a session into the wiki, a manual export or the `brain ingest-event` workflow is required.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Created `scripts/import-claude.ts` to normalize and ingest Claude session transcripts into the `raw/` repository with project-specific tagging. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Ported Claude session log parsing to TypeScript (scripts/import-claude.ts) to maintain a single runtime and support project-specific tagging. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`

- **2026-04-18**: Detailed import-claude.ts flags (--days, --project, --min-turns) and content filtering logic (collapsing tools, hash dedup). Source: `raw/docs/mm/2026-04-17T21-35-18-150Z.md`
- **2026-04-18**: Developed `scripts/import-claude.ts` to natively import and deduplicate Claude sessions with project-specific tagging, replacing external python dependencies. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`

 - **2026-04-18**: Finalized `import-claude.ts` with support for last-X-days filtering (`--days`), project-substring matching (`--project`), and trivial session exclusion (`--min-turns`). Verified that text-turn extraction correctly collapses tool calls to minimize noise. Source: `raw/claude/mm/2026-04-18T13-17-59-097Z.md`
- **2026-04-19**: Clarified that session importers (Claude, Codex, Gemini) insert rows into `raw_events` and `events_fts` rather than writing to the `raw/` filesystem by default. Source: `raw/docs/mm/2026-04-19T12-17-11-625Z.md`
- **2026-04-19**: Built `scripts/import-claude.ts` to natively import Claude session transcripts, applying Schema v4's `source_type` and `project` tagging, with filters for days and turns. Source: `event:75cb839d-179a-4ceb-943b-f15902342cf8`
- **2026-04-19**: Rewrote the importer to land sessions in `raw_events` exclusively (no `.md` writes). Implemented tool-call filtering, turn flattening, and incremental imports using an `import_state` table with a 5-minute settled-session check. Source: `event:bafb9bad-14b7-4beb-9ef1-68ed866cc842`
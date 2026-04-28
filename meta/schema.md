# Brain Schema

This file defines how the brain is organized and how an agent should maintain it.

The brain has three layers:

- `/raw/`: immutable source material, organized as `raw/<source_type>/<project>/<file>.md`
- `/wiki/`: maintained knowledge pages (flat, project-agnostic)
- `/meta/`: navigation, rules, and operational logs

The agent should treat markdown as the source of truth. SQLite is an index and job-state layer, not the canonical knowledge layer.

## SQLite Operational Tables

`schema_version` is currently `14`.

Session transcript importers write one `raw_events` row per vendor session with a vendor-prefixed `external_id` such as `claude:<session_id>`, `codex:<session_id>`, or `gemini:<session_id>`. `import_state.external_id` keeps the raw vendor session id so the Active Agents surface and ac `llm_sessions.id` matching remain compatible.

R1 session tracking adds four derived tables:

- `session_index`: one row per `(vendor, session_id)`, linked to `raw_events.id` when available and to ac participants when the ac DB can resolve the session. Missing linkage is represented as `state='orphan'` with an `orphan_reason`.
- `session_message_links`: prompt-footer links from chain messages to imported sessions. Legacy footers without `chain_msg_id` or `chain + chain_seq` are parsed but not inserted because the table is keyed by `chain_msg_id`.
- `session_usage`: one row per `(vendor, session_id)` with canonical input/output/cached/reasoning token totals, priced cost, pricing source, and a JSON `cost_breakdown`. Pricing rates come from operator-editable `pricing.toml`.
- `session_events`: durable state-transition stream for session lifecycle events, replayable over `/api/v1/sessions/events` and filtered through `session_index` project/role linkage.

Existing DBs can populate these tables and migrate old unprefixed `raw_events.external_id` values in place with `bun scripts/backfill-r1.ts`.

## Raw-entry provenance

Every raw entry is tagged with two orthogonal fields stored both in `raw_entries` (SQLite) and implied by the filesystem path:

- **`source_type`** — the channel the material came from. Stable taxonomy:
  - `claude` — Claude Code session transcripts
  - `telegram` — Telegram chat exports
  - `chains` — ac chain messages
  - `docs` — project documentation
  - `research` — research notes
  - `knowledge` — curated knowledge-base entries
  - `raw` — default for legacy / hand-added content
- **`project`** — the domain slug, e.g. `mm`, `ac`, `claude-usage`. Proliferates.

Filesystem layout mirrors these: `raw/<source_type>/<project>/<timestamp>.md`. Legacy flat files under `raw/*.md` are read as `source_type='raw'`, `project='unknown'`.

Search and query endpoints accept optional `source_types` and `projects` filters. Wiki pages are compiled truth and always participate in both FTS and vector search unless `source_types` is set and explicitly excludes `wiki`. Raw chunks are filtered by `source_type` and `project` as specified.

## Operating Rules

1. Brain-first: before answering from memory or searching the web, search the local brain first.
2. Prefer update over duplication: if a page already exists for the subject, update it instead of creating a near-duplicate.
3. Preserve provenance: every meaningful wiki update must be traceable to one or more raw entries.
4. Log operations: every ingest, page creation, and significant update should be appended to `meta/log.md`.
5. Keep links healthy: do not introduce broken `[[wiki links]]`.

## Canonical Page Identity

Each page has:

- `title`: human-readable display name
- `slug`: canonical page id
- `aliases`: alternate names users may search or mention

### Filename Rule

The canonical filename is:

- preserve Unicode characters
- replace spaces with underscores
- preserve case when useful for readability

### Link Rule

Always link to the canonical filename target.
Use: `[[Gemini_CLI|Gemini CLI]]`.
Do not use freehand `[[Gemini CLI]]` when the file is `Gemini_CLI.md`.

## Wiki Page Model (New Format)

Each wiki page follows this strict structure.

```md
---
title: Example Title
slug: Example_Title
aliases: [Example Alias]
tags: [concept]
type: entity
confidence: 0.8
mentions: 5
tier: 2
status: active
created_at: 2026-04-17
updated_at: 2026-04-17
source_count: 3
---

# Example Title

## Summary
A concise paragraph representing the **Compiled Truth**. This section is rewritten by the agent as new evidence arrives to reflect the most current and accurate understanding.

## Cross-References
- [[Related_Page|Related Page]]
- [[Other_Concept|Other Concept]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-17**: Fact or observation. Source: `raw/docs/mm/2026-04-17T10-00-00-000Z.md`
- **2026-04-18**: New evidence from a Claude session. Source: `raw/claude/mm/2026-04-18T14-23-45-000Z.md`
```

### Required Frontmatter

- `title`: Human name.
- `slug`: Unique ID.
- `aliases`: List of alternate names.
- `tags`: Classification tags.
- `type`: One of `entity`, `concept`, `source`, `analysis`.
- `confidence`: 0.0 to 1.0 (float).
- `mentions`: Total times this subject was encountered.
- `tier`: 1 (High Importance), 2 (Standard), 3 (Stub/Low Signal).
- `created_at`: ISO date.
- `updated_at`: ISO date.
- `status`: `active`, `stale`, or `archived`.
- `source_count`: Number of unique raw sources contributing to this page.

### Structure Rules

1. **Compiled Truth**: The `## Summary` section contains the "best current guess" of the truth. It is synthesized from the timeline.
2. **Append-Only Timeline**: Content below the `---` separator and `<!-- TIMELINE: ... -->` comment is **never edited or deleted**, only appended to. It contains the raw evidence bullets.
3. **Cross-References**: Navigation links to other pages.

## Page Types

- `entity`: People, organizations, places.
- `concept`: Ideas, abstract topics, skills.
- `source`: Specific books, papers, or large raw datasets.
- `analysis`: Synthesized reports or derived insights.

## Provenance

Every bullet in the **Timeline** must cite a `raw/` file by its full current path (e.g. `raw/claude/mm/2026-04-18T….md`). Flat legacy paths (`raw/example.md`) are allowed only for pre-migration files that still sit at the top of `raw/`.
Every claim in the **Compiled Truth** must be derivable from the Timeline.

## Contradictions

If new material conflicts with old material:
- Keep the old bullet in the timeline.
- Add the new bullet to the timeline.
- Resolve the conflict in the **Compiled Truth** (Summary) by mentioning the change or the current best understanding.

## Index And Log

### `meta/index.md`
Catalog grouped by primary tag. Each entry must have a one-line summary.

### `meta/log.md`
Operational record of all brain actions.

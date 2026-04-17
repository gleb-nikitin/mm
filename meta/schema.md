# Brain Schema

This file defines how the brain is organized and how an agent should maintain it.

The brain has three layers:

- `/raw/`: immutable source material
- `/wiki/`: maintained knowledge pages
- `/meta/`: navigation, rules, and operational logs

The agent should treat markdown as the source of truth. SQLite is an index and job-state layer, not the canonical knowledge layer.

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

Examples:

- `Gemini CLI` -> `Gemini_CLI.md`
- `Vital Proteins` -> `Vital_Proteins.md`
- `Психологическая устойчивость` -> `Психологическая_устойчивость.md`

### Link Rule

Always link to the canonical filename target.

Use:

- `[[Gemini_CLI|Gemini CLI]]`
- `[[Vital_Proteins|Vital Proteins]]`
- `[[Психологическая_устойчивость|психологической устойчивости]]`

Do not use freehand `[[Gemini CLI]]` when the file is `Gemini_CLI.md`.

## Raw Entry Rules

Raw entries live in `/raw/` and are immutable.

A raw entry should contain:

- heading
- source metadata when known
- body content

Raw entries may be imported from:

- manual notes
- chat history
- API saves
- future transcripts and clips

Do not rewrite old raw entries during synthesis. Create new wiki updates instead.

## Wiki Page Rules

Each wiki page should follow this structure.

```md
---
title: Example Title
slug: Example_Title
aliases: [Example Alias]
tags: [concept]
status: active
created_at: 2026-04-17
updated_at: 2026-04-17
source_count: 1
---

# Example Title

## Summary

Short synthesized overview in 1-3 sentences.

## Evidence

- **2026-04-17**: Fact or observation. Source: `raw/example.md`

## Related

- [[Another_Page|Another Page]]
```

### Required Frontmatter

Required for every new or normalized page:

- `title`
- `slug`
- `aliases`
- `tags`
- `created_at`

Recommended:

- `updated_at`
- `status`
- `source_count`

### Required Sections

At minimum:

- `# Title`
- `## Summary`
- `## Evidence`

Optional:

- `## Updates`
- `## Timeline`
- `## Related`
- `## Open Questions`

## Page Types

Use simple tag-based typing.

Common tags:

- `person`
- `project`
- `concept`
- `place`
- `product`
- `tool`
- `health`
- `running`

Prefer a small number of meaningful tags. Do not create taxonomy sprawl.

## Create vs Update

Create a new page when:

- the subject is clearly distinct
- the subject is mentioned repeatedly or has durable value
- a missing page would leave multiple broken links

Update an existing page when:

- the new material adds facts, events, preferences, or relationships to an existing subject
- the new material is a better formulation of the same concept
- the subject already exists under a title or alias

Do not create a new page only because the wording differs.

## Evidence And Provenance

Every durable claim should be tied to a raw source.

Minimum acceptable evidence entry:

- date if known
- concise fact
- source raw file path if known

Preferred format:

```md
- **2025-09-03**: Described a birthday in [[Архыз|Архызе]] with hiking, cold-water swimming, and [[Баня|баней]]. Source: `raw/...`
```

If exact source path is not yet available in the page body, it must still be recoverable from logs or SQLite. Do not fabricate provenance.

## Contradictions

If new material conflicts with old material:

- do not silently overwrite
- append the new evidence
- mark the contradiction in prose
- prefer dated statements over undated ones

Example:

```md
- **2025-08-24**: Reported X. Source: `raw/...`
- **2025-09-10**: Later contradicted X and reported Y instead. Source: `raw/...`
```

## Index And Log

### `meta/index.md`

Purpose:

- catalog wiki pages
- one-line summary per page
- enable index-drill retrieval

The index should be grouped by broad page type.

### `meta/log.md`

Purpose:

- append-only operational record
- describe what raw item was processed
- describe which pages were created or updated

Preferred log line format:

```md
- 2026-04-17: Processed snippet "Title"; updated Page_A, Page_B; created Page_C.
```

## Language Rules

- keep the page title in the language that best matches the subject
- do not translate proper nouns unnecessarily
- preserve user vocabulary when it matters
- keep links canonical even if the visible alias is inflected or translated

## Quality Bar

Good page:

- has a clear summary
- contains only durable information
- uses canonical links
- includes evidence
- avoids fluff and repetition

Bad page:

- duplicates another page
- contains only vague summary text with no evidence
- introduces broken links
- mixes multiple subjects with no clear primary page owner

## Temporary Rule Until Code Catches Up

The deterministic harness is still incomplete. Until dedicated commands exist:

- read existing wiki files before editing
- normalize new pages to this schema
- repair broken links when touching related pages
- append to `meta/log.md` for every meaningful maintenance action


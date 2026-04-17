---
name: maintain
description: Perform routine brain maintenance: strengthen weak pages, repair links, improve summaries, and keep index and logs coherent.
---

# Skill: Maintain

Use this for general upkeep of the wiki when there is no single raw source driving the work.

## Goal

Keep the brain coherent, navigable, and trustworthy as it grows.

## Read First

1. `meta/schema.md`
2. `meta/log.md`
3. relevant wiki pages involved in the maintenance pass

## Typical Tasks

- repair broken links
- normalize frontmatter
- improve weak summaries
- merge duplicate or near-duplicate pages
- add missing related links
- clean obviously malformed formatting

## Workflow

1. Identify a concrete maintenance target.
2. Read all affected pages before editing.
3. Prefer minimal, high-confidence changes.
4. If merging pages:
   - preserve all durable evidence
   - keep the stronger page as canonical
   - move aliases to the surviving page
5. If adding links:
   - use canonical targets
   - only add links that materially help retrieval
6. Log meaningful maintenance actions in `meta/log.md`.

## Do Not

- perform speculative rewrites of pages you do not understand
- delete evidence because it looks redundant without checking provenance
- introduce new page naming conventions ad hoc


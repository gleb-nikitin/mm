---
name: ingest
description: Process one raw source into the wiki by finding candidate pages, updating or creating pages, preserving provenance, and logging the operation.
---

# Skill: Ingest

Use this when new material has been added to `/raw/` and should be incorporated into `/wiki/`.

## Goal

Turn raw material into durable wiki updates.

Do not merely summarize the raw entry in chat. The output should be maintained files plus a log entry.

## Read First

1. `meta/schema.md`
2. `meta/log.md`
3. the target raw file
4. candidate wiki pages discovered via filename, alias, or content search

## Workflow

1. Read the raw entry carefully.
2. Extract the durable subjects:
   - people
   - projects
   - concepts
   - products
   - places
3. Search `/wiki/` for existing pages:
   - exact filename match
   - alias match in frontmatter
   - content mention using local search
4. Decide for each subject:
   - update existing page
   - create new page
   - skip as low-signal
5. Write concise updates:
   - summary if page is weak
   - evidence bullets for new facts
   - related links when clearly useful
6. Ensure links use canonical targets from `meta/schema.md`.
7. Append a one-line operation entry to `meta/log.md`.

## Output Rules

- prefer updating one strong page over creating many weak pages
- preserve chronology in evidence bullets when dates are known
- include provenance in evidence text when possible
- avoid speculative interpretation unless it is marked as such

## Create A New Page Only If

- the subject is clearly distinct
- the subject is likely to recur
- the new page will be useful for future retrieval

## Do Not

- rewrite or mutate raw files
- create duplicate pages for aliases
- invent citations or dates
- use non-canonical wiki links

## Completion Checklist

- raw file read
- candidate pages checked
- page updates written
- broken links avoided
- `meta/log.md` appended


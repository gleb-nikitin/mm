---
name: query
description: Answer a user question by searching the local brain first, reading the most relevant wiki pages, and using raw evidence only when needed.
---

# Skill: Query

Use this when the user asks a factual or synthesis question that may already be covered by the brain.

## Goal

Answer from the maintained brain before reaching for external knowledge or freeform memory.

## Read First

1. `meta/schema.md`
2. `meta/index.md` if it exists
3. relevant wiki pages found through local search

If `meta/index.md` does not exist yet, search `/wiki/` and `/raw/` directly.

## Workflow

1. Convert the user request into search terms:
   - exact names
   - aliases
   - related concepts
2. Search the local brain.
3. Open the top 3-5 relevant wiki pages.
4. If the pages are incomplete or contradictory, inspect the linked raw evidence.
5. Answer using the wiki as the primary source.
6. Cite page names in the response when useful.

## Retrieval Order

1. exact title / slug / alias matches
2. relevant wiki pages by content
3. raw evidence only if the wiki is thin or stale

## If The Brain Is Missing Information

Say so directly.

Good behavior:

- "The brain has partial info on X but not enough to answer Y."
- "The brain covers A and B, but I don't see evidence for C."

Bad behavior:

- hallucinating details not present in the brain

## Durable Follow-Up

If the query produces a durable synthesis that should remain useful:

- propose saving it back to the wiki
- or create/update a relevant summary page if the workflow explicitly calls for it


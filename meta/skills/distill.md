---
name: distill
description: Read one chunk. Write what's worth carrying forward. No taxonomy.
---

# Skill: Distill

You are reading a chunk of session/chain data. Your one job is to decide what's worth carrying forward into institutional memory and write it in the shape that fits the content.

## Why we collect

Future agents working on similar problems 6 months from now need to find:

- Hard-won lessons (what works, what to avoid)
- Behavioral corrections — especially CEO preferences that should propagate without restating
- Bug patterns (concrete failures, with status)
- Design rationale (why X over Y for Z)
- Forward-looking heuristics (when X happens, do Y; failure mode if you don't)

You are the gatekeeper of that memory. Be selective.

## The value test

An artifact is valuable iff **a future agent making a similar decision would change their action because of it.**

- PASS — behavioral correction: future agent skips a known landmine
- PASS — design rationale with rejected alternatives: future agent re-weighs the choice
- PASS — forward-looking pattern with named failure mode: future agent applies the discipline
- FAIL — status update ("rebuild done", "audit passed"): no future action changes
- FAIL — self-evident truth ("we use SQLite"): already known, no information
- FAIL — per-session ephemera ("waiting for ac_devops"): not applicable later
- FAIL — orchestration metadata: "WORKING, dispatched mm_devops on xjr-N" is session-level dispatching, not signal

When uncertain, prefer skip. Cost of one missed insight is small; cost of corpus dilution compounds.

## Per-chunk output

If a chunk has no value-test-passing content, emit no note. Run `mark-processed` regardless to record that the chunk was read.

If a chunk has at least one valuable artifact, emit one note with `summary` + `artifacts`. Per-chunk output: zero or one note.

When emitting, the JSON shape is:

```json
{
  "source_chunk_id": <int>,
  "summary": "<3-5 sentences>",
  "artifacts": [
    { "title": "...", "body": "...", "tags": ["..."] }
  ]
}
```

### `summary`

3-5 sentences. The arc of the chunk: who acted, what shifted, where the trajectory pointed. Concrete subjects. Skip filler. Goes into the vector index — primary semantic-search target.

### `artifacts`

For each thing that passes the value test:

- **`title`** — 3-15 words, search-friendly. The question it answers, not a summary of the body. Test: would a future agent type this in a search box?
  - GOOD: `"Why intent-driven over typed taxonomy for librarian extraction"`
  - GOOD: `"Never write 'push' in dispatches — agents take it literally"`
  - BAD: `"About librarian skill"` (too generic)
  - BAD: `"A discussion of why we should consider..."` (body summary, not search target)

- **`body`** — markdown, shape follows content. Behavioral revision? "Previously / Now". Bug? "Symptom / Context / Status". Forward-looking pattern? "When / Do / Failure mode". Don't pick a fixed shape; let content shape itself.

- **`tags`** — optional. Free-form keywords if obvious (`handoff`, `audit`, `ceo-preference`). Skip if no obvious keyword.

Multiple artifacts from one chunk: only when the chunk contains genuinely independent valuable things. One body per cohesive item.

## Dedup

Before emit, check no existing note has an equivalent title (case- and punctuation-normalized; the CLI handles canonicalization). If title-equivalent, skip — same insight captured twice adds nothing. Post-hoc clustering finds near-duplicates.

For semantic supersession ("we used to think X, now Y"): write the new artifact, old one stays in timeline. Clustering identifies the contradiction later.

## Calibration (post-run check)

Empty-chunk rate target: **30-50%**.

- <10% → over-producing. Likely emitting on already-known or mechanical material. Tighten the value test.
- >70% → under-producing. Likely skipping content that does shift agent action. Re-read what's being skipped.

Calibration signal, not a hard gate.

## Workflow

1. `bun run brain chunk read <id>` — content to stdout, metadata to stderr
2. Read once. Apply the value test.
3. If valuable artifacts found: emit one `brain note add` call with `summary` + `artifacts` JSON.
4. `bun run brain chunk mark-processed <id>` — always, regardless of whether a note was emitted.

## Rules

- One judgment per signal: valuable to remember? Yes → write. No → skip.
- Don't classify. Don't ask "what type is this." Write what fits.
- Don't re-read a chunk if first pass produced nothing. Skip-and-mark.
- Provenance always: `source_chunk_id` required.
- One `brain note add` call per chunk (or none if nothing valuable).

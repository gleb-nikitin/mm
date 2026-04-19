# Handoff — mm_devops

Last updated 2026-04-19. End of session that retired the per-event librarian
flow and replaced it with a mechanical Narrative Chunker.

## Why this session existed

Last session shipped schema v9 + `ingest-event <external_id>` — targeted
wiki synthesis from a single DB event. In practice that unit is wrong:
individual chat sessions (one `raw_events` row) are either too big (up to
120KB) to digest cleanly or too small to be worth the preamble tax the
librarian pays on every Gemini invocation. The chain of "read 20K of schema
+ skills to ingest 1K of text" was the core friction.

## What changed

- **Schema v10**: `raw_events.chunked INTEGER DEFAULT 0`. Distinct from
  `processed`, so the targeted `ingest-event` path still works for ad-hoc
  use while the chunker-based path becomes the default.
- **`scripts/chunk-events.ts`**: reads `raw_events WHERE chunked=0 AND
  processed=0`, splits content at turn boundaries ("User:" / "Assistant:"
  / "A:" / "Human:") into ~12KB chunks (hard cap 18KB, oversized turns
  sub-split on paragraphs → lines → hard cut as last resort), writes to
  `raw/events/<project>/<ts>-<idprefix>[-NNofMM].md` with frontmatter
  (source_type: events, event_external_id, chunk_index/total) and a
  Provenance footer. Marks `chunked=1`. Idempotent; `--rechunk` to force.
  Flags: `--project <p>`, `--dry-run`, `--rechunk`.
- **`process-new.command`**: now runs `import-claude → chunk-events →
  index rebuild` before launching the interactive librarian. The librarian
  no longer needs to know about `raw_events` at all in the normal path —
  chat sessions surface as ordinary `raw_entries` with `source_type=events`.
- **`agent/roles/lib/soul-interactive.md`**: simplified lifecycle. One
  queue, one loop (`read-raw` → synthesize → `page create|update --source
  <id> --claim` → `mark-processed`). Event-side CLI demoted to "ad-hoc
  fallback".
- **Behavior tests**: 3 new chunker tests (split + idempotent + rebuild →
  raw_entries). Schema version test bumped from v9 to v10 and asserts
  the `chunked` column.

## Verification (all green)

- `bun run typecheck` ✓
- `bun test` → 10 pass / 0 fail / 56 expect() calls (5 consecutive runs)
- Live-data spot check: ran chunker against project `1-rust-test` (4
  events → 31 chunks, all ≤18KB), confirmed `brain index rebuild` picks
  them up as 31 `raw_entries` with `source_type='events'`, then reverted.

## Known issues / gaps

- **Title extraction**: `internalRebuildIndex` matches `^# ` at start of
  content, which misses titles that sit after YAML frontmatter. All
  chunk files (and any other frontmattered raws) fall back to filename as
  title. Low-impact but worth fixing with a `/m` flag + skip frontmatter.
- **`update_wiki.js` at repo root**: a scratch JS helper the librarian
  wrote last session. Left in the baseline commit for provenance. Delete
  when it's clear nothing depends on it (nothing should — `brain page
  update` covers the same ground).
- **`.gemini/system.md`** (25KB) appears on disk while Gemini is running;
  now gitignored.
- **`internalRebuildIndex` processed-reset**: on hash change, the rebuild
  sets `processed=0`. Defensible (edited raws should re-ingest), but
  noisy if someone touches a raw file by hand. Worth a heads-up in any
  operator-facing doc.

## What's staged for the next librarian run

- **35 mm chunks** under `raw/events/mm/` (7 events × 1–9 chunks each,
  sizes 2.2–18.3KB). All sitting at `raw_entries.processed = 0` alongside
  the 14 docs / 5 claude / 3 research entries that are already ingested.
- Committed explicitly (1398fd5) so the librarian has durable input even
  if the DB is wiped.

**Explicit scope decision**: chunker was NOT run across the other ~540
backfilled events (ac, au, u-au, etc). Running Gemini synthesis at that
scale today would cost more to throw away and redo once we have a
production-grade model than to defer it. Keep the default posture of
`--project mm` (or similar one-project scoping) until that model is
settled.

## Next candidates (pick one per session)

1. **Drain the 35 mm chunks through the librarian.** Run
   `./process-new.command`. This is the first real end-to-end test of
   the chunker → `raw_entries` → interactive librarian → wiki path on
   vital data. Watch for: duplicate claims (because the 7 source events
   were already ingested via `ingest-event`), chunk-level provenance
   quality vs the old per-event provenance, and the librarian's own
   feedback in `changes.md`.
2. **Vector pass over `raw/events/*.md`** (previously-deferred "vectors
   over raw_events"). Since chunks now live as `raw_entries`, the existing
   `embedBrain()` picks them up automatically the next time it runs — so
   this may be free. Verify and retire the reserved-lane hack in
   `hybridSearch` once ranking is sound.
3. **Title extraction fix** in `internalRebuildIndex` (skip frontmatter,
   match `# ` on first non-frontmatter line). Small, isolated, improves
   every `brain queue` / dashboard display.

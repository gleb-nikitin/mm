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

## Next candidates (pick one per session)

1. **Run chunker across all backfilled projects** and let the librarian
   drain the queue. This is the first real end-to-end test of the new
   flow on production data. ~550 events across ~40 projects → probably
   1500–3000 chunks. Decide scope (all vs `--project mm` first) before
   kicking it off.
2. **Vector pass over `raw/events/*.md`** (previously-deferred "vectors
   over raw_events"). Since chunks now live as `raw_entries`, the existing
   `embedBrain()` picks them up automatically the next time it runs — so
   this may be free. Verify and retire the reserved-lane hack in
   `hybridSearch` once ranking is sound.
3. **Title extraction fix** in `internalRebuildIndex` (skip frontmatter,
   match `# ` on first non-frontmatter line). Small, isolated, improves
   every `brain queue` / dashboard display.

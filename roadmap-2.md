# Roadmap 2

This roadmap is based on the live repo state, not on earlier drafts.

Current reality:

- the core loop works: raw -> process -> wiki -> search
- `query` does not currently exist as an exposed CLI command
- provenance exists, but `process` still allows a weak success path when no new claims are recorded
- HTTP and MCP surfaces exist and are usable
- FTS5 works; vector search does not exist yet

This roadmap focuses on what should happen next in the highest-leverage order.

## Phase 0: Tighten The Spine

Goal: remove the remaining correctness footguns before adding more features.

- Make `brain process` fail closed:
  - if Gemini returns success but adds no claims, do not mark the raw entry as processed
  - add an explicit path for `no durable claim` if you want that behavior
- Make `internalRebuildIndex` non-destructive:
  - upsert instead of delete-all/re-insert where possible
  - or at minimum, preserve all columns not derivable from markdown
- Make page update side effects stricter:
  - require page existence checks before claim writes
  - verify metadata refresh succeeds before logging success
- Add a small migration strategy:
  - schema version table
  - explicit migrations instead of relying on `CREATE TABLE IF NOT EXISTS`
- Fix or remove `import-chats.ts`
  - it still points at an outdated data model and should not silently drift
- Remove unused dependencies:
  - `better-sqlite3`
  - `ts-node`
  - `zod`

Exit:

- a raw entry cannot become `processed=1` without valid provenance or an explicit skip reason
- schema changes are reproducible across fresh and existing DBs
- package.json reflects what the repo actually imports

## Phase 1: Upgrade The Page Model

Goal: adopt the strongest idea from Opus/GBrain without destabilizing the harness.

- Move from:
  - frontmatter + summary + evidence + related
- To:
  - frontmatter
  - compiled truth section
  - cross-references
  - append-only timeline separator
- Extend `wiki_pages` with:
  - `type`
  - `confidence`
  - `mentions`
  - `tier`
- Add `meta/skills/RESOLVER.md`
  - single dispatcher that points the agent to the right skill
- Update:
  - `meta/schema.md`
  - `meta/skills/ingest.md`
  - `page create`
  - `page update`
  - markdown index generation

Exit:

- all new pages use compiled truth + timeline format
- existing pages are migrated cleanly

## Phase 2: Query, Save, And Deterministic Utility

Goal: add the missing daily-use flows on top of the existing search spine.

Work:

- add intent shaping:
  - entity lookup
  - temporal query
  - conceptual synthesis
- improve retrieval context:
  - exact slug/alias hits first
  - top page summaries
  - full page bodies only for top 3-5
- require explicit source citations in the answer
- add `--save`:
  - save the answer back as `analysis` when useful
- add `save` command:
  - this is `add` plus content-hash dedup
  - semantic dedup stays deferred to Phase 4
  - write freeform conversation insight to raw
  - register as unprocessed
  - optional candidate page suggestions

Exit:

- `brain query "what do I know about X?"` produces a grounded answer with citations
- `brain query --save` creates durable analysis pages
- `brain save` makes conversations compound

## Phase 3: Deterministic Lint

Goal: move brain health checks out of prompt prose and into code.

- Implement deterministic `brain lint`:
  - broken links
  - orphan pages
  - missing compiled truth
  - missing timeline
  - frontmatter violations
  - alias collisions
  - pages with no provenance
  - stale-page detection:
    - pages whose `updated_at` is old
    - and newer raw entries mention the same subject
- Add `brain lint --fix` for safe fixes only
- Add a structured markdown report

Exit:

- `brain lint` works with no LLM involved
- the report is specific enough to act on immediately

## Phase 4: Semantic Retrieval

Goal: add embeddings only after the lexical spine is solid.

- Add `chunks` table
- Add chunking strategy:
  - about 400 tokens
  - overlap only if needed
- Build a small eval set before changing retrieval:
  - 10-20 queries
  - expected relevant pages
  - baseline FTS-only results
- Choose embedding source:
  - preferably local first
  - Gemini only if the operational tradeoff is worth it
- Add vector similarity support
- Implement hybrid search:
  - FTS5
  - vector similarity
  - RRF fusion
- Add semantic dedup on save/ingest

Exit:

- search quality is measurably better than FTS-only on a small eval set
- repeated saves do not bloat the brain

## Phase 5: Dream / Doctor / Validate

Goal: create the maintenance flywheel.

- `brain doctor`
  - DB integrity
  - FTS integrity
  - counts and coverage
  - latency snapshot
- `brain validate "<claim>"`
  - confirmed / partial / contradicted / unknown
- `brain dream`
  - tier promotion
  - stale-page detection
  - citation repair
  - merge candidates
  - gap detection
  - refresh index/timeline/log
  - merge candidates are only logged for review
  - dream never auto-merges or auto-deletes pages

Exit:

- the brain can report its health
- the brain can critique claims against stored evidence
- unattended maintenance is possible

## Phase 6: External Surface Refresh

Goal: make MCP and HTTP reflect the stronger core.

- MCP:
  - improve `search_brain` to include scores and summaries
  - add `query_brain`
  - add `validate_claim`
  - add `brain_stats`
  - reduce shell-out style tools where possible
- HTTP:
  - add `/query`
  - add `/validate`
  - add `/stats`
  - add cleaner wiki routes like `/wiki/:slug`
  - keep markdown-first responses

Exit:

- external agents use the same improved core without special-case logic

## Recommended Order

1. Phase 0: Tighten the spine
2. Phase 1: Upgrade the page model
3. Phase 2: Query, save, and deterministic utility
4. Phase 3: Deterministic lint
5. Phase 4: Semantic retrieval
6. Phase 5: Dream / doctor / validate
7. Phase 6: External surface refresh

## What Not To Do Yet

- do not build a stylized web UI yet
- do not adopt vector search as the primary retrieval path
- do not do a big `src/` refactor unless it directly helps one of the phases above
- do not add more ingestion sources until the current ingestion path is strict and reliable

## Open Tracked Gaps

These remain valid and should stay tracked in `meta/remaining-gaps.md`:

- semantic retrieval is not implemented yet
- ingest create-vs-update decisioning is still mostly model-driven
- the HTTP surface is useful but not a real UI
- `brain process` still builds prompt context through inline string concatenation
- if schema/skills/raw payloads grow, prompt construction will need explicit context budgeting

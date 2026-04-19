# Handoff — mm_devops

Last updated 2026-04-20. Session focused on search quality, wiki extraction model, and project-scoped wiki namespacing.

## What changed this session

### Search fixes (`src/core.ts`)
- **FTS AND→OR**: `buildFtsQuery` now joins terms with `OR` — natural language queries work.
- **Wiki FTS filter bug fixed**: wiki pages were excluded from search whenever any filter was set. Now only excluded when `source_types` explicitly omits `wiki`.
- **Vector arm filter bug fixed**: vector search was forcing `owner_type='raw'` when any filter set, silently skipping all wiki embeddings. Fixed to always include wiki chunks unless `source_types` excludes `wiki`.
- **`walkWiki()` + `wikiPath()`**: new helpers in `core.ts` for recursive wiki traversal and path resolution. All scan sites updated to use them.

### Wiki extraction model (`meta/skills/ingest.md`)
- Completely rewritten. Old: "find named entities → Wikipedia articles." New: "scan 9 categories per chunk, append to bucket pages, one pass per read."
- 9 extraction buckets: `Arch_Decisions`, `Known_Bugs`, `Future_Tasks`, `Friction_Points`, `Code_Changes`, `How_It_Works_Now`, `User_Notes`, `Corrections`, `Future_Ideas`.

### Project-scoped wiki namespacing
- Wiki pages now live under `wiki/<project>/` (e.g. `wiki/mm/Arch_Decisions.md`).
- Slugs in DB are `mm/Arch_Decisions` — the slug IS the relative subpath.
- `internalRebuildIndex`, `lint`, `process`, `embedBrain` all updated to use `walkWiki()`.
- `page create` now calls `mkdirSync(..., { recursive: true })` before writing.

### CLI improvements (`src/brain.ts`)
- `brain add` / `brain save`: added `--project` and `--source-type` flags.
- `brain queue`: added `--project` filter (was unscoped, now mirrors `queue-events`).

### Operational scripts
- `scripts/reset-brain.ts`: wipes `raw/**`, `wiki/*.md`, `meta/brain.db*`, generated reports. Recreates empty raw subdirs.
- `reset-brain.command`: double-click macOS shortcut for the above.
- `process-new.command`: now imports all 3 providers (claude + codex + gemini), respects `DAYS` env var (default 1), passes `--project mm` to queue in Librarian prompt, runs `brain embed` after Librarian finishes.

### Lib role files + ingest skill
- `agent/roles/lib/soul.md`, `soul-interactive.md`, `briefing.md`, `role.md`: rewritten around extraction model.

## Verification

- `bun run typecheck` ✓
- `bun run brain index rebuild` ✓ (8 pages indexed as `mm/*` slugs)
- Brain reset + full re-process ran successfully (Gemini used 9% context for all mm sessions)
- MCP search returning wiki pages correctly after restart

## Known issues / next candidates

1. **`brain embed` after Librarian**: wiki pages created by Gemini during the Librarian session aren't in `wiki_pages` when `index rebuild` runs (rebuild happens before Gemini writes pages). Workaround: manually run `brain index rebuild && brain embed` after `process-new.command` completes. Fix: add a post-Librarian rebuild step to the command.
2. **Corrections.md not created**: Librarian didn't find corrections in the sessions. May need a hint in `ingest.md` for what counts as a correction.
3. **`brain.ts` title extraction**: `internalRebuildIndex` uses `^# ` match that skips frontmatter — chunk files fall back to filename as title. Low-impact but noisy in queue display.
4. **Archive-done script**: friction points marked `✅` accumulate in active pages. A sweep script to move resolved entries to `wiki/<project>/Archived_Done.md` is planned.

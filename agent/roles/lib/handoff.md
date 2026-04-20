# Handoff: mm_lib

## Current State (2026-04-20, post-wipe)

- **Artifacts**: 0. DB was wiped for a clean v11 validation run.
- **Chunks**: 0 in `chunks_virtual`. Will be repopulated when importers + chunker run.
- **Raw events**: 0. Will be re-imported by `scripts/import-*.ts` on next `process-new.command`.
- **Schema**: v11 (artifacts + artifact_sources + chunks_virtual + artifacts_fts; legacy tables empty).
- **Backup**: `meta/brain.db.pre-wipe-bk` holds the pre-wipe state if rollback is needed.

## Blockers

- None.

## Next Steps

1. Run `DAYS=30 ./process-new.command` to re-import sessions + chunk + invoke the Librarian.
2. After the Librarian session, verify artifact quality via `/artifacts-ui` or `bun run brain artifact list --project mm --limit 20`.
3. Confirm the Librarian created **no** `wiki_pages` or `search_index` rows (v11 doesn't touch them). Check `/raw-ui` to eyeball.

## Known hazards (fixed just before this run)

- `briefing.md` previously carried v10 content ("9 Extraction Buckets", `brain read-raw`, wiki page append) which overrode the v11 skill. Rewritten to v11-pure.
- Prior runs produced stray `wiki_pages` rows because briefing.md told the Librarian to write them. Should no longer happen.

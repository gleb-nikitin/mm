# Handoff — mm_devops

## Wish I knew

**The MCP server holds the DB connection open.** After `reset-brain.command` deletes `meta/brain.db`, the MCP process still has a stale file descriptor. `brain index rebuild` won't help. Only a full Claude Code restart re-spawns `bun src/mcp.ts` against the fresh DB.

**WAL checkpoint before debugging DB issues.** If MCP or CLI behaves strangely after a reset, run:
```
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('meta/brain.db'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); console.log('done');"
```

**Gemini creates wiki pages AFTER `index rebuild` runs.** `process-new.command` runs `index rebuild` before launching the Librarian. Pages the Librarian writes during its session won't be in `wiki_pages` or have embeddings until you manually run `brain index rebuild && brain embed` afterward. This is the #1 source of "where are my pages?" confusion.

**Wiki slugs are project-scoped subpaths.** `wiki/mm/Arch_Decisions.md` → slug `mm/Arch_Decisions`. Every `path.join(PATHS.wiki, slug + '.md')` call works because the slug encodes the subdirectory. Don't flatten slugs.

**`brain queue` needs `--project mm`.** Without it, shows all projects. The Librarian prompt scopes to mm; the CLI default doesn't.

**Ollama must be running for vector search to work.** FTS still works without it but scores are flat (~0.016). `curl http://localhost:11434/api/tags` to check. Model needed: `nomic-embed-text`.

**`DAYS=365 ./process-new.command` for a full re-ingest after brain reset.** Default is 1 day, which imports nothing historical.

**Typecheck is the gate.** Always run `bun run typecheck` after touching `src/`. The project has no CI.

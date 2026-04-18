# How to index

Raw files on disk aren't queryable until mm's SQLite tables + vector chunks are rebuilt from them. This guide covers the three scenarios you'll hit.

## Pipeline at a glance

Markdown on disk is the source of truth. Two derived layers need to be refreshed when the disk changes:

1. **SQLite tables** — `raw_entries`, `wiki_pages`, `search_index` (FTS5), `wiki_aliases`, `wiki_links`. Rebuilt by scanning the filesystem.
2. **Vector chunks** — `chunks` table with embeddings. Generated from `wiki_pages` content.

`/search`, `/query`, and all MCP tools read from both layers. If a new page is on disk but the layers aren't refreshed, the page is invisible to queries.

## Three scenarios

### A. You imported raw content

Raw files landed on disk via `import-claude.ts`, the `/add` endpoint, `bun run brain add`, or `save`.

```sh
bun run brain index rebuild
```

Rebuilds `raw_entries` from filesystem. Now `bun run brain queue` shows the new entries, and filtered search (`/search?source=claude&project=mm`) can find them (once chunks are generated — see below).

Raw entries do not auto-generate vector chunks today. Until that gap is closed, raw content is reachable through FTS but not through vector search. The 5a "raw-chunk embedding" todo fixes this.

### B. Gemini wrote wiki files (current ingest workflow)

Gemini just finished an ingest pass. Wiki files are on disk under `wiki/*.md`. SQLite doesn't know yet; there are no embeddings.

```sh
bun run brain index rebuild    # populate wiki_pages, search_index, aliases, links
bun run brain embed             # generate vector chunks for every wiki page
```

Order matters: `embed` reads `wiki_pages` from the DB, so `index rebuild` must run first.

Verify:

```sh
bun run brain stats          # page count should match wiki/*.md file count
bun run brain search "..."   # should return new pages
bun run brain query "..."    # should cite new pages in the synthesis
```

### C. You used `bun run brain process`

mm's built-in LLM-driven ingest command handles everything: reads unprocessed raw entries, invokes Gemini with the ingest skill, creates/updates wiki pages, then rebuilds the index at the end of each entry. **No manual index steps needed.**

```sh
bun run brain process     # runs the full loop
bun run brain embed       # still needs to run separately if wiki changed
```

## Commands reference

| Command | What it does |
|---|---|
| `bun run brain index rebuild` | Walk `raw/` and `wiki/` recursively; upsert `raw_entries`, `wiki_pages`, `search_index`, `wiki_aliases`, `wiki_links`. Deletes DB rows for files no longer on disk. |
| `bun run brain embed` | Generate vector chunks for every wiki page. Chunk types: `wiki_truth` (above `---`), `wiki_timeline` (below `<!-- TIMELINE -->`). Skips chunks already embedded. |
| `bun run brain embed --all` | Force re-embed — drops all chunks first, regenerates. Use after prompt/model changes. |
| `bun run brain embed <slug>` | Re-embed one wiki page by slug. Use after editing one page. |
| `bun run brain timeline` | Rebuild `meta/timeline.md` from wiki Timeline sections. |
| `bun run brain lint` | Deterministic health checks (broken links, missing frontmatter, etc.). Writes `meta/lint-report.md`. Does NOT rebuild the index. |
| `bun run brain doctor` | Combined health check. Writes `meta/doctor-report.md`. |
| `bun run brain dream` | Full maintenance pass: rebuild index + markdown index + timeline, plus LLM-assisted merge/promotion. Also generates `meta/dream-report.md`. |

## Which commands trigger a rebuild

This surprises people. Not every command refreshes the index.

| Command | Rebuilds index? |
|---|---|
| `brain process` | ✅ yes, after each raw entry processed |
| `brain dream` | ✅ yes, at the end of the pass |
| `brain index rebuild` | ✅ yes, explicit |
| `brain embed` | ❌ no (relies on wiki_pages being already populated) |
| `brain lint` | ❌ no (read-only against current DB state) |
| `brain doctor` | ❌ no |
| `brain search` / `query` / `validate` | ❌ no (read-only) |

So after any filesystem edit outside of `process`/`dream`, you need `index rebuild` to make changes visible.

## Troubleshooting

**"Page exists on disk but search doesn't return it."**
The index hasn't been rebuilt. Run `bun run brain index rebuild`.

**"Search returns the page but `/query` doesn't cite it."**
The page has no embeddings yet. Run `bun run brain embed`.

**"A page I deleted from disk still shows up in search."**
`index rebuild` cleans up rows for files no longer on disk — run it. If stale embeddings remain after, `bun run brain embed --all` regenerates.

**"Filtered search (`?source=X&project=Y`) returns nothing."**
When `source`/`project` filters are set, wiki FTS is skipped and only raw-owned vector chunks match. If raw entries haven't been vector-embedded yet (today's gap — see todo 5a), filtered search won't find them. Workaround: ingest them into wiki pages via `brain process` or Gemini, then `index rebuild` + `embed`.

## Good post-ingest habit

One-liner to run after any external edit (Gemini ingest, manual wiki edit, bulk import):

```sh
bun run brain index rebuild && bun run brain embed
```

Add to a `.command` file or shell alias if you do this often.

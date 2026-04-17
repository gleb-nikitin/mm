# Upgrade Roadmap: Where We Are → Where We Should Go

> Incorporates review from both opus-plan.md and Codex feedback on plan.md.

## Current State Audit

### What Exists (working)

| Component | Status | Honest Assessment |
|-----------|--------|-------------------|
| **SQLite schema** | ✅ Done | `raw_entries`, `wiki_pages`, `wiki_aliases`, `wiki_links`, `claims`, `claim_sources`, `operations_log`, FTS5 `search_index`. Real relational model, not a single `entries` dump. |
| **CLI harness** (`brain.ts`) | ✅ Done | `add`, `search`, `read`, `queue`, `process`, `page create/update`, `claim-add`, `log-append`, `index rebuild`, `timeline rebuild`, `links check`. Internal helpers exist (`internalRebuildIndex`, `internalRebuildMarkdownIndex`, etc.) — it's not as raw as it may look from the outside. |
| **FTS5 search** | ✅ Done | Basic keyword search via `search_index MATCH`. Exact phrase only. No ranking beyond FTS5 default BM25. |
| **Provenance system** | 🟡 Partial | `claims` + `claim_sources` tables exist. `process` command checks for claims before/after, but **still marks entries processed even when no claims were added** (brain.ts line ~335). This is a real gap — entries can pass through without provenance. |
| **Skill files** | ✅ Done | `ingest.md`, `query.md`, `lint.md`, `maintain.md`, `import-chat.md`. Well-structured, actionable. |
| **Schema** | ✅ Done | `meta/schema.md` — page identity, link rules, frontmatter spec, create-vs-update, contradiction handling. Solid. |
| **Index + Log + Timeline** | ✅ Done | Auto-rebuilt from SQLite. Log is append-only. |
| **MCP server** (`mcp.ts`) | ✅ Done | 8 tools: `search_brain`, `get_backlinks`, `add_claim`, `list_unprocessed`, `read_wiki`, `add_to_brain`, `process_brain`, `maintain_brain` |
| **HTTP API** (`api.ts`) | ✅ Done | `/add`, `/search`, `/read`, `/index`, `/log`, `/timeline`, `/lint` — all return markdown |
| **LLM integration** | ✅ Done | `gemini -p` via `execFileSync`, used in `process` command |
| **Page format** | 🟡 Structure done, separator not | Frontmatter + Summary + Evidence + Related is in place and works. What's missing is specifically the compiled-truth / `---` / append-only-timeline separator from GBrain. |
| **Wiki content** | 🟡 Tiny | 2 pages (`Gleb_Nikitin`, `Hiking`), 2 raw entries. Enough to prove the loop works. |
| **Code structure** | 🟡 Monolithic but not terrible | `brain.ts` is one file but has internal helpers. DB init is duplicated across `brain.ts`, `api.ts`, `mcp.ts`. Not disastrous, but will cause friction as features grow. |

### What Has No Code Yet

| Feature | Where it comes from | Priority |
|---------|-------------------|----------|
| **Compiled truth + timeline page format** | opus-plan (from GBrain) | High — better page model |
| **RESOLVER.md** | opus-plan (from GBrain) | High — single dispatcher for skills |
| **`query` command** (search + LLM synthesis) | plan.md Phase 3, opus-plan Phase 2 | High — makes the brain useful daily |
| **`save` command** (write-back from conversations) | opus-plan (from WizRAG) | Medium — conversations should compound |
| **Deterministic `lint`** (in code, not just skill) | plan.md Phase 3, opus-plan Phase 3 | Medium — catch rot automatically |
| **Vector embeddings + hybrid search** | plan.md Phase 5, opus-plan Phase 2 | Medium — needed at scale, not yet |
| **`dream` cycle** (overnight maintenance) | opus-plan (from GBrain) | Medium — the flywheel |
| **`doctor` diagnostic** | opus-plan (from GBrain) | Low — nice-to-have |
| **`validate` command** | opus-plan (from WizRAG) | Low — nice-to-have |
| **Entity auto-escalation** (tiers) | opus-plan (from GBrain) | Low — needs content mass first |

---

## The Upgrade Plan

### Guiding Principles (from Codex review)

1. **Keep deterministic ownership explicit.** Don't fall into "the LLM does everything else." Every command should have clear deterministic behavior. The LLM does judgment work *within* structured workflows.
2. **Embeddings are V2, not the spine.** FTS5 + metadata is the foundation. Vector search supplements later.
3. **The `src/` refactor is optional, not mandated.** If splitting into modules helps the next feature, do it. Don't refactor for the sake of refactoring. The current helpers in `brain.ts` are functional.
4. **Page format matters now.** Compiled truth + timeline is a better model than flat Evidence — adopt it while there are only 2 pages to migrate.

---

### Phase 1: Page Model + RESOLVER (1 session)

**Goal**: Better data model. Single skill dispatcher.

- [ ] **Adopt compiled truth + timeline page format**:
  ```markdown
  ---
  type: entity | concept | source | analysis
  slug: example
  title: Example
  aliases: [Ex]
  tags: [concept]
  status: stub | active | merged | archived
  confidence: 0.9
  mentions: 1
  tier: 3
  created_at: 2026-04-17
  updated_at: 2026-04-17
  source_count: 1
  ---

  Compiled truth — current best understanding. Rewritten when evidence changes.

  ## Cross-References
  - [[related-page]]

  ---
  <!-- TIMELINE: append-only below -->
  - 2026-04-17: Created from raw/... [source: raw/...]
  ```
- [ ] **Add `type`, `confidence`, `mentions`, `tier` to `wiki_pages` table** (ALTER TABLE migration)
- [ ] **Migrate existing 2 pages** to new format
- [ ] **Update `page create` command** to emit new format
- [ ] **Update `meta/schema.md`** with new page spec
- [ ] **Create `meta/skills/RESOLVER.md`** — intent → skill routing table. Single entry point.
- [ ] **Update `ingest.md` skill** to reference new format

**Exit**: New pages created in compiled truth + timeline format. RESOLVER.md exists and routes correctly.

---

### Phase 2: Query + Save + Lint (2 sessions)

**Goal**: Make the brain useful in daily work. All deterministic.

#### `brain query`
- [ ] **`brain query "<question>"`**:
  1. Search FTS5 → top results
  2. Read full wiki page content for top 3-5
  3. Build prompt: question + retrieved context + schema conventions
  4. Call `gemini -p` → grounded answer with `[source: slug]` citations
  5. Print to stdout
- [ ] **`--save` flag**: file the answer back as a new wiki page (type: `analysis`)
- [ ] Simple intent heuristics: name → entity lookup, "when" → temporal, else → general

#### `brain save`
- [ ] **`brain save "<text>" [--title "..."]`**:
  1. Content hash check → skip if already exists
  2. Write to `raw/`
  3. Register in `raw_entries` as unprocessed
  4. Optionally attach to most relevant existing page by FTS5 match
- [ ] This is how conversations compound — the WizRAG pattern

#### `brain lint` (deterministic, no LLM)
- [ ] Check for:
  - Broken `[[links]]` — target slug doesn't exist as page or alias
  - Orphan pages — no inbound links
  - Missing compiled truth — page has no content above the timeline separator
  - Missing timeline — page has no entries below the separator
  - Frontmatter violations — missing required fields
  - Alias collisions — two pages claiming the same alias
- [ ] Output: structured markdown report, grouped by severity
- [ ] **`brain lint --fix`** — auto-fix safe issues (add missing frontmatter defaults)

#### Fix provenance enforcement
- [ ] **Fix `process` command**: do NOT mark entry processed when wiki changed but no claims were recorded. Currently brain.ts marks it processed in the else branch regardless.

**Exit**: `brain query "what do I know about hiking?"` returns a grounded answer. `brain lint` catches structural problems without an LLM. `brain save` lets conversations persist. Provenance is actually enforced.

---

### Phase 3: Vector Embeddings + Hybrid Search (2 sessions)

**Goal**: Graduate search quality. FTS5 alone will plateau at ~50 pages.

- [ ] **Choose embedding approach**:
  - Recommended: local ONNX model via `@xenova/transformers` (offline, fast, ~384 dims)
  - Alternative: `gemini` API embeddings if accessible via CLI
- [ ] **Add `chunks` table**: `(id, page_slug, text, embedding BLOB, created_at)`
- [ ] **Register `cosine_similarity(a, b)` as custom SQLite function** via `bun:sqlite`
- [ ] **Implement chunking**: ~400 tokens, 20% overlap
- [ ] **`brain embed [--all | --stale | <slug>]`** — generate/refresh embeddings
- [ ] **Hybrid search**:
  1. FTS5 keyword (BM25) → rank list
  2. Vector cosine on chunks → rank list
  3. RRF fusion: `score = Σ 1/(60 + rank)`
  4. Compiled-truth boost for wiki pages vs raw chunks
  5. Dedup overlapping chunks from same page
- [ ] **Semantic dedup** on save: cosine distance < 0.02 → skip chunk
- [ ] **Update `brain search` and `brain query`** to use hybrid pipeline

**Exit**: Search uses both keyword and semantic signals. Repeated saves don't bloat the DB. Measurably better than FTS5-only on a test set of 20+ pages.

---

### Phase 4: Dream Cycle + Doctor (1-2 sessions)

**Goal**: The brain maintains itself overnight.

#### `brain dream`
- [ ] **Entity escalation**: tier 3 pages with `mentions >= 3` → promote to tier 2 (expand via LLM)
- [ ] **Stale detection**: pages with `updated_at` > 30 days but new raw entries mention them
- [ ] **Citation repair**: verify all `[[links]]` resolve, fix obvious slug mismatches
- [ ] **Consolidation**: find near-duplicate pages (cosine > 0.95 on compiled truth if embeddings exist, else skip) → log as merge candidates (don't auto-merge)
- [ ] **Gap detection**: concepts mentioned 3+ times across pages but with no dedicated page → log as suggestions
- [ ] **Refresh index + timeline**
- [ ] **Log everything** to `meta/log.md`

#### `brain doctor`
- [ ] DB integrity: `PRAGMA integrity_check`
- [ ] FTS5 health: `INSERT INTO search_index(search_index) VALUES('integrity-check')`
- [ ] Embedding coverage: chunks with embeddings / total chunks (if Phase 3 done)
- [ ] Stats: page count, raw count, link count, claim count, avg source_count
- [ ] Search latency: time a sample query

#### `brain validate`
- [ ] **`brain validate "<claim>"`**:
  1. Search KB for relevant context
  2. Compare claim against stored evidence
  3. Report: ✅ confirmed, ⚠️ partial, ❌ contradicted, ❓ no data (with sources)

#### Cron
- [ ] Recipe: `0 2 * * * cd /path/to/brain && bun run brain dream >> meta/dream.log 2>&1`

**Exit**: `brain dream` runs unattended. Entity tiers promote. `brain doctor` reports health. `brain validate` checks claims.

---

### Phase 5: External Surfaces Refresh (1 session)

**Goal**: MCP + HTTP reflect the improved core.

#### MCP
- [ ] `search_brain` → uses hybrid search (when available), returns ranked results with scores
- [ ] Add `query_brain` tool (search + synthesize)
- [ ] Add `validate_claim` tool
- [ ] Add `brain_stats` tool (doctor output)
- [ ] Replace fragile `process_brain` / `maintain_brain` (which shell out) with proper implementations

#### HTTP
- [ ] `GET /query?q=<question>` → synthesized answer (markdown)
- [ ] `GET /save?d=<data>` → save context
- [ ] `GET /validate?q=<claim>` → validation report
- [ ] `GET /wiki/<slug>` → page by slug (cleaner than `/read?slug=`)
- [ ] `GET /stats` → brain stats
- [ ] Root `/` → WizRAG-style instruction page (teaches any LLM how to use the brain)
- [ ] All endpoints still return `text/markdown`

**Exit**: Claude Code / Cursor can `query_brain` through MCP and get grounded answers. Any browser-capable LLM can use the HTTP surface by reading the instruction page.

---

## Phase Sequence

```
1  Page Model + RESOLVER     ← small, sets data model for everything
2  Query + Save + Lint       ← makes the brain useful daily
3  Vector + Hybrid Search    ← graduates search quality at scale
4  Dream + Doctor + Validate ← the brain maintains itself
5  MCP + HTTP Refresh        ← expose the good core externally
```

Phase 1 is prep (1 session). Phase 2 is the core daily value (2 sessions). Phase 3 is the search upgrade (2 sessions). Phases 4-5 are the flywheel (2-3 sessions).

---

## What plan.md Got Right (Keep)

- Markdown is truth, SQLite is index
- Thin harness, fat skills — with **explicit deterministic ownership**
- Provenance is mandatory (but needs the enforcement fix)
- Brain-first retrieval order
- Embeddings as a later phase, not the V1 spine
- FTS5 + metadata as the foundation

## What opus-plan.md Adds (Adopt)

- **Compiled truth + timeline** page format (the strongest single addition)
- **RESOLVER.md** as skill dispatcher (currently missing)
- **`dream`, `doctor`, `validate`** as later-phase commands
- **More opinionated HTTP surface** (instruction page, cleaner URLs)
- **`save` command** from WizRAG (conversations compound)
- **Entity auto-escalation** (tier system)

## What opus-plan.md Gets Wrong (Don't adopt as-is)

- **Too aggressive on vector-first** — the main architecture diagram and search path assume embeddings are the spine. They're not. They supplement.
- **"The LLM does everything else"** is too loose — plan.md's explicit deterministic ownership is better
- **The `src/` refactor** — possible implementation detail, not a plan-level commitment. Refactor when it helps a feature, not as a standalone phase.

## What upgrade-opus.md v1 Got Wrong (Corrected)

- ~~"No query command"~~ — `brain search` exists, but there is no `brain query` (search + synthesize). The distinction matters: `search` returns page hits, `query` should return a synthesized answer.
- ~~"Process command enforces provenance"~~ — partially true. It checks for claims before/after, but still marks entries processed when no claims were added in the happy path. This needs a fix.
- ~~"Everything in one monolithic brain.ts"~~ — directionally true but overstated. Internal helpers exist. The code is structured, just not modular.
- ~~"Page format is not done"~~ — the page *structure* (frontmatter, summary, evidence, related) is done. What's missing is specifically the compiled-truth/timeline *separator* pattern.

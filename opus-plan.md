# MT — Personal Knowledge Brain

> Synthesized from: [Karpathy's LLM-Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), [WizRAG Cross-Chat KB](https://github.com/g0rd33v/wizrag/blob/main/cross-chat-knowledge-base.md), [GBrain](https://github.com/garrytan/gbrain)

## The Bet

Every knowledge tool today has the same flaw: **knowledge doesn't compound**. RAG rediscovers from scratch every query. Chat history evaporates. Notes rot because nobody maintains cross-references. The three sources converge on one insight:

> An LLM can do the bookkeeping humans abandon — the summarizing, cross-referencing, contradiction-flagging, and maintenance that makes a knowledge base *actually useful* over time. The human curates and thinks. The LLM does everything else.

This plan takes the best concrete patterns from each source and combines them into a single local-first system.

---

## Best Ideas Extracted

### From Karpathy (LLM-Wiki)
| Idea | Why it matters |
|---|---|
| **Three-layer separation**: raw sources → wiki → schema | Clean ownership. Raw is immutable truth. Wiki is LLM-generated derivative. Schema governs behavior. |
| **Ingest / Query / Lint lifecycle** | Not just "search docs" — a discipline. Ingest compiles knowledge. Query retrieves it. Lint keeps it healthy. |
| **index.md + log.md** | Cheap, effective navigation without embeddings at small scale (<500 pages). Log is parseable with grep. |
| **Wiki as git repo** | Free versioning, branching, diffing. Human can always read/edit raw markdown. |
| **Filing answers back into wiki** | Explorations compound. A good analysis shouldn't vanish into chat history. |

### From WizRAG (Cross-Chat KB)
| Idea | Why it matters |
|---|---|
| **URL-as-API, markdown-as-SDK** | Any LLM that can fetch a URL becomes a client. Zero integration code. |
| **Read-write RAG** | The KB grows from conversations, not just uploads. `save` is as important as `ask`. |
| **Semantic dedup** (cosine < 0.02) | Prevents bloat from repeated saves across sessions. |
| **Validate command** | LLM self-checks against the KB. RAG as guardrail, not just retrieval. |
| **Wiki changelog** | Track how knowledge evolved. Essential for trust and debugging drift. |

### From GBrain (Garry Tan)
| Idea | Why it matters |
|---|---|
| **Thin harness, fat skills** | Runtime is dumb plumbing. Intelligence lives in skill files (fat markdown docs encoding full workflows). |
| **Compiled truth + timeline per page** | Top = current best understanding (rewritten). Bottom = append-only evidence trail (never edited). Brilliant separation. |
| **Hybrid search: vector + keyword + RRF** | Keyword misses conceptual matches, vector misses exact phrases. RRF fusion gets both. |
| **Entity auto-escalation** (Tier 3→2→1) | Stub on first mention → enriched after 3 mentions → full pipeline after meeting/8+ mentions. Brain learns who matters without being told. |
| **Dream cycle** | Overnight autonomous maintenance: enrich entities, fix citations, consolidate, self-heal. You wake up and the brain is smarter. |
| **RESOLVER.md** | Single dispatcher that routes intent to the right skill. Agent reads one file to know what to do. |
| **`gbrain doctor`** | Self-diagnostic. Shows trajectory ("intent classifier: 87% deterministic, up from 40%"). |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         mt (Bun + TS)                           │
│                                                                 │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────────────┐ │
│  │  raw/    │   │   wiki/      │   │   skills/               │ │
│  │          │   │              │   │                         │ │
│  │ immutable│──▶│ LLM-generated│   │  fat markdown docs      │ │
│  │ sources  │   │ compiled     │   │  encoding workflows     │ │
│  │ (md,pdf, │   │ knowledge    │   │                         │ │
│  │  txt,url)│   │              │   │  RESOLVER.md (dispatch) │ │
│  └──────────┘   └──────┬───────┘   └────────────┬────────────┘ │
│                        │                         │              │
│                        ▼                         │              │
│  ┌─────────────────────────────────────────────┐ │              │
│  │              SQLite + FTS5                  │ │              │
│  │                                             │ │              │
│  │  pages      (slug, type, body, frontmatter) │ │              │
│  │  chunks     (page_id, text, embedding BLOB) │ │              │
│  │  timeline   (page_id, date, event, source)  │ │              │
│  │  links      (from_slug, to_slug, kind)      │ │              │
│  │  log        (timestamp, op, detail)         │ │              │
│  │                                             │ │              │
│  │  FTS5 virtual table on pages.body           │ │              │
│  │  Vector search via cosine on chunks         │ │              │
│  └─────────────────────────────────────────────┘ │              │
│                        │                         │              │
│                        ▼                         ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      CLI (mt)                               ││
│  │                                                             ││
│  │  mt ingest <file|dir|url>     mt query <question>           ││
│  │  mt save <data>               mt get <slug>                 ││
│  │  mt lint                      mt search <keywords>          ││
│  │  mt doctor                    mt serve (MCP/HTTP)           ││
│  │  mt dream                     mt export                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                        │                                        │
│                        ▼                                        │
│               gemini -p "<prompt>"                              │
│               (all LLM calls go through CLI)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Why SQLite + FTS5 (not Postgres)

- **Zero config**. Single file. No server. `bun:sqlite` is built-in native binding.
- **FTS5** gives us keyword search with BM25 ranking out of the box.
- **Vector search**: store embeddings as `Float32Array` BLOBs, compute cosine similarity in a custom SQL function registered via `bun:sqlite`. No pgvector, no external service. Works up to ~100k vectors without any exotic indexing.
- **Portable**. The entire brain is one `.sqlite` file + a `raw/` directory + a `wiki/` directory. Copy it anywhere.

### Vector Strategy

For embeddings, two options (choose based on preference):

1. **Gemini embeddings via CLI** — `gemini -p "embed: <text>"` → parse vector from output. Free, consistent with the LLM stack.
2. **Local embeddings** — Use a Bun-compatible ONNX runtime with a small model (e.g., `all-MiniLM-L6-v2`, 384 dims). Fully offline. Fast.

Store as BLOB in `chunks` table. Register a `cosine_similarity(a, b)` function in SQLite.

---

## Data Model

### Page (the core unit)

Every page follows GBrain's **compiled truth + timeline** pattern:

```markdown
---
type: concept | entity | source | analysis | index
slug: do-things-that-dont-scale
title: Do Things That Don't Scale
tags: [startups, growth]
sources: [raw/pg-essay-2013.md]
confidence: 0.92
created: 2026-04-17
updated: 2026-04-17
mentions: 3
tier: 3
---

Paul Graham's argument that startups should do
unscalable things early because the unscalable effort
teaches you what users actually want.

## Key Claims
- Unscalable effort → user insight (HIGH confidence)
- Recruiting users one at a time is not a failure mode

## Cross-References
- [[build-something-people-want]]
- [[founder-mode]]

---
<!-- TIMELINE: append-only, never edit above this line -->

- 2013-07-01: Published on paulgraham.com [source: raw/pg-essay-2013.md]
- 2026-04-17: Ingested into brain. Connected to 2 existing pages.
```

**Above the `---`**: compiled truth. Rewritten when new evidence arrives.
**Below**: timeline. Append-only evidence trail. Never edited, only added to.

### Entity Auto-Escalation (from GBrain)

| Tier | Trigger | Action |
|------|---------|--------|
| 3 | First mention | Stub page: name, context of mention, source |
| 2 | 3+ mentions across different sources | Expand: summary, key facts, cross-refs |
| 1 | 8+ mentions or direct ingest | Full page: compiled truth, timeline, all connections |

The `mentions` counter in frontmatter tracks this. `mt dream` checks for tier promotions.

---

## Core Operations

### 1. Ingest

```
mt ingest raw/article.md
```

Flow:
1. Read source file, chunk it (~400 tokens, 20% overlap)
2. Generate embeddings for each chunk → store in `chunks`
3. Call `gemini -p` with the source text + existing index → LLM returns:
   - Summary page for wiki
   - Updated entity/concept pages (which existing pages to touch)
   - New cross-references to add
   - Contradictions with existing claims (flagged, not auto-resolved)
4. Write/update wiki pages
5. Update `index.md`
6. Append to `log.md` and `timeline` table
7. Semantic dedup: skip chunks with cosine distance < 0.02 to any existing chunk

### 2. Query

```
mt query "what themes show up across my notes?"
```

Flow:
1. **Intent classification** (simple heuristic first, LLM fallback): entity lookup? temporal? conceptual? general?
2. **Hybrid search**:
   - FTS5 keyword search (BM25) → ranked results
   - Vector cosine search on chunks → ranked results  
   - **RRF fusion**: `score = Σ 1/(60 + rank)` across both lists
3. Read top-K wiki pages
4. Call `gemini -p` with retrieved context + question → grounded answer
5. **Optionally file the answer back** as a new wiki page (Karpathy's insight)

### 3. Save (from WizRAG)

```
mt save "key insight from today's conversation: ..."
```

- Semantic dedup check first
- Chunk, embed, store
- Attach to relevant existing pages or create a new page
- This is how **conversations compound** — not just ingested documents

### 4. Lint (from Karpathy)

```
mt lint
```

Scans the wiki for:
- ❌ Contradictions between pages (same claim, different values)
- 📅 Stale claims superseded by newer sources
- 🔗 Orphan pages with no inbound links
- 📝 Concepts mentioned but lacking their own page
- 🔍 Missing cross-references
- 📊 Pages with low confidence scores
- 🏷️ Frontmatter violations (missing required fields)

Returns an actionable report. `mt lint --fix` auto-fixes what it can.

### 5. Dream (from GBrain)

```
mt dream
```

The overnight cycle. Runs unattended:
1. **Entity escalation**: check if any Tier 3 entities should promote to Tier 2
2. **Stale check**: flag pages whose sources are older than configurable threshold
3. **Citation repair**: verify all `[[links]]` resolve, fix broken ones
4. **Consolidation**: merge near-duplicate pages (cosine > 0.95)
5. **Gap detection**: find topics with many mentions but no dedicated page
6. **Log everything** to `log.md` and `timeline`

Can be run via cron: `0 2 * * * cd /path/to/brain && mt dream`

### 6. Doctor (from GBrain)

```
mt doctor
```

Self-diagnostic:
- DB integrity check
- Embedding coverage (% of pages with embeddings)
- FTS5 index health
- Orphan detection
- Skill resolver coverage
- Stats: total pages, total chunks, total links, search latency p50/p95

### 7. Validate (from WizRAG)

```
mt validate "my understanding of X is Y"
```

- Searches KB for relevant context
- Compares your claim against stored ground truth
- Reports: ✅ confirmed, ⚠️ partially supported, ❌ contradicted (with sources)

---

## Search Architecture

```
Query
  │
  ├──▶ FTS5 (BM25 keyword ranking)──────────┐
  │                                          │
  ├──▶ Vector cosine (embedding similarity)──┤
  │                                          │
  │                                    RRF Fusion
  │                                    score = Σ 1/(60 + rank)
  │                                          │
  │                                    Cosine re-score
  │                                    Compiled-truth boost (+0.1)
  │                                          │
  │                                    Dedup (same page, overlapping chunks)
  │                                          │
  │                                     Top-K results
  │
  └──▶ (future) Multi-query expansion via LLM
```

**Why RRF?** Reciprocal Rank Fusion is dead simple and works. No learned weights, no tuning. Proven in GBrain at 5k+ pages.

**Compiled-truth boost**: pages containing compiled truth (the rewritten synthesis above the `---`) score slightly higher than raw timeline entries. This surfaces understanding, not just evidence.

---

## Skill System

Following GBrain's **thin harness, fat skills** philosophy:

```
skills/
  RESOLVER.md          # intent → skill routing table
  ingest.md            # full ingest workflow
  query.md             # search + synthesis workflow
  lint.md              # health check protocol
  dream.md             # overnight maintenance cycle
  enrich-entity.md     # entity escalation rules
  write-page.md        # page creation conventions
  conventions/
    quality.md         # citation rules, confidence thresholds
    formatting.md      # frontmatter schema, page structure
```

**RESOLVER.md** is the single entry point. When the LLM needs to do anything, it reads RESOLVER first, which tells it which skill file to load. Skills are fat — they encode the full workflow, quality bars, edge cases, and chaining rules.

The runtime (`mt` CLI) is thin. It handles:
- SQLite CRUD
- Embedding computation
- FTS5 queries
- Vector similarity
- Shelling out to `gemini -p`
- File I/O

Everything else — what to synthesize, how to cross-reference, when to escalate — lives in skills.

---

## HTTP/MCP Server (optional)

```
mt serve --port 8787
```

Exposes the WizRAG-style URL-as-API:

```
GET /ask?q=<query>           → markdown answer
GET /save?d=<data>           → save context
GET /validate?q=<claim>      → validation report
GET /wiki                    → index page
GET /wiki/<slug>             → wiki page
GET /wiki/lint               → health report
GET /wiki/log                → changelog
```

All endpoints return `text/markdown`. This lets any LLM (ChatGPT, Claude, Grok) that can browse URLs interact with your brain. The URL is the API. The markdown is the SDK.

Also expose as MCP server via stdio for Claude Code / Cursor / etc.

---

## File Structure

```
mt/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── db.ts                 # SQLite + FTS5 setup, migrations
│   ├── embed.ts              # embedding generation (gemini or local)
│   ├── search.ts             # hybrid search (FTS5 + vector + RRF)
│   ├── ingest.ts             # chunking, embedding, page generation
│   ├── query.ts              # search + LLM synthesis
│   ├── lint.ts               # wiki health checks
│   ├── dream.ts              # overnight maintenance
│   ├── doctor.ts             # self-diagnostic
│   ├── serve.ts              # HTTP + MCP server
│   ├── llm.ts                # gemini CLI wrapper
│   └── utils.ts              # slug generation, frontmatter parsing
├── skills/
│   ├── RESOLVER.md
│   ├── ingest.md
│   ├── query.md
│   ├── lint.md
│   ├── dream.md
│   └── conventions/
│       ├── quality.md
│       └── formatting.md
├── brain/                    # the actual knowledge (gitignored or separate repo)
│   ├── raw/                  # immutable sources
│   ├── wiki/                 # LLM-generated pages
│   │   ├── index.md
│   │   └── log.md
│   └── brain.sqlite          # all structured data
├── package.json
├── tsconfig.json
└── README.md
```

---

## Build Phases

### Phase 1: Foundation (the "it works on 10 files" milestone)
- [ ] SQLite schema + FTS5 virtual table setup
- [ ] `mt ingest <file>` — chunk, embed (via gemini), store, generate wiki page
- [ ] `mt search <query>` — FTS5 keyword search only (no vector yet)
- [ ] `mt get <slug>` — read a page
- [ ] `index.md` + `log.md` auto-maintenance
- [ ] Compiled truth + timeline page format

### Phase 2: Intelligence (hybrid search, synthesis)
- [ ] Vector embeddings stored as BLOBs + cosine similarity function
- [ ] Hybrid search with RRF fusion
- [ ] `mt query <question>` — search + LLM synthesis via gemini
- [ ] `mt save <data>` — read-write from conversations
- [ ] Semantic dedup (cosine < 0.02)
- [ ] Cross-reference link tracking in `links` table

### Phase 3: Autonomy (self-maintaining brain)
- [ ] `mt lint` — contradiction detection, orphan scan, gap analysis
- [ ] `mt dream` — overnight cycle (escalation, citation repair, consolidation)
- [ ] `mt doctor` — self-diagnostic
- [ ] `mt validate` — claim checking against KB
- [ ] Entity auto-escalation (Tier 3 → 2 → 1)

### Phase 4: Access (serve it to any LLM)
- [ ] `mt serve` — HTTP server with markdown GET endpoints
- [ ] MCP server for Claude Code / Cursor integration
- [ ] URL-as-API pattern from WizRAG

### Phase 5: Polish
- [ ] Multi-query expansion (LLM rewrites query into 3 variants for better recall)
- [ ] Wiki rebuild (re-cluster, re-generate from all chunks)
- [ ] `mt export` to static markdown site
- [ ] Cron recipes for dream cycle

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | SQLite + FTS5 | Zero config, single file, Bun native binding, portable |
| Vector | BLOBs in SQLite + custom cosine fn | No external vector DB. Works to ~100k vectors. Graduate to pgvector only if needed. |
| LLM | `gemini -p` via CLI | Already in stack. No API keys to manage. Swap model by changing CLI flag. |
| Page format | Compiled truth + timeline | GBrain's best idea. Clean separation of understanding vs evidence. |
| Search | FTS5 + Vector + RRF | Proven at scale in GBrain. Simple, no learned weights. |
| Skills | Fat markdown files | Intelligence in prompts, not code. Easy to iterate. Human-readable. |
| Runtime | Thin Bun CLI | Just plumbing: DB, files, shell out to gemini. The skills are the product. |
| Serving | GET + markdown | WizRAG's insight: any LLM that can browse is already a client. |

---

## What This Is *Not*

- **Not a chatbot**. No chat UI. Interaction happens in your existing LLM (via CLI, MCP, or URL).
- **Not a RAG pipeline**. RAG retrieves raw chunks. This builds compiled knowledge that compounds.
- **Not a note-taking app**. You don't write the wiki. The LLM writes it. You curate sources and ask questions.
- **Not a team tool** (yet). Single-user, local-first. Team features are Phase N+1.

---

## Sources & Credit

- Karpathy's LLM-Wiki pattern: the compounding wiki insight, ingest/query/lint lifecycle, filing answers back
- WizRAG: URL-as-API, read-write RAG, semantic dedup, validate command, cross-platform sync
- GBrain: compiled truth + timeline, thin harness / fat skills, hybrid search with RRF, entity auto-escalation, dream cycle, doctor diagnostic

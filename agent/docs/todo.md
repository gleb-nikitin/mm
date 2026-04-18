# Todo

Rolling list of deferred work. Rewrite when it drifts — don't append forever. Keep each entry small enough that a future session can pick it up without needing to rediscover the context.

## What mm actually is

mm is not a memory engine that happens to be useful for project management. mm is a **project-management primitive** whose input is conversation, whose durable artifact is markdown, and whose mechanism is **LLM-mediated extraction** driven by skill files.

- **Knowledge layer** → `wiki/` (compiled truth, extracted by `ingest`).
- **Action layer** → `agent/docs/*.md` files (todos, bugs, decisions, corrections, friction) — each extracted by a dedicated `derive-*` skill from the same conversational input.
- **Provenance layer** → `raw/<source_type>/<project>/` + `claims` table — every artifact traceable to a source.

The **skills library is the product**. Code is infrastructure. Skills are markdown files that encode extraction procedures; new skills extend mm's capabilities without new code. That principle is load-bearing for the whole sequence below.

## Sequence

Do them in this order. Each step unblocks the next.

1. **Tests** (blocks everything else — safety net + quality evals)
2. **Skills library & extensibility** (the product — methodology proof)
3. **Refactor** (readability + architectural + pluggable storage trait)
4. **External-dependency hygiene** (provider abstraction + briefing + streaming)
5. **Retrieval quality** (chunking, dedup, rerank, intent, expansion)
6. **Public-release polish** (owner decisions)
7. **Mnemonic Hardcore** (Rust migration — deferred until methodology proves out)

## 1. Tests

Goal: enough safety net that refactors can't silently change behavior, plus quality evals so retrieval tweaks (step 5) and the Hardcore migration (step 7) can be measured, not guessed.

### 1a. Behavior tests

- Write **behavior-level** tests only (CLI commands, HTTP endpoints, MCP tool calls). No unit tests against internal helpers — those couple to the current shape and block refactor.
- Boot each test against a fresh `MT_BRAIN_ROOT` in a temp dir with empty `raw/ wiki/ meta/`.
- Minimum suite:
  - fresh-root bootstrap creates schema v4
  - `POST /add` (or CLI `add`) writes a raw file, stamps source_type/project, and bumps `/stats`
  - `search`, `query`, `validate`, `doctor`, `lint`, `dream` run to completion on a small seeded brain
  - MCP `search_brain` / `query_brain` / `brain_stats` return expected shapes
  - Source/project filters actually narrow results (`/search?source=claude&project=mm`)
- Stub or mock Ollama and Gemini — the real calls are too slow and non-deterministic for a test suite.
- Pick a test runner: `bun test` is the obvious default (no extra deps).

### 1b. Retrieval-quality eval harness (gbrain-inspired)

- Pin a small **eval dataset**: ~30 question/expected-citation pairs derived from real wiki content. Version-controlled under `meta/evals/`.
- Command: `bun run brain eval` → runs every question through `hybridSearch` and `queryBrain`, scores against expected citations.
- Metrics: **P@k**, **Recall@k**, **MRR**, **nDCG@k** — standard retrieval metrics. gbrain uses these; we should too.
- Baseline the current TS/Bun stack before any tweak; every change to 5a–5d has to hold or improve the numbers.
- Critical for the Hardcore migration (step 7) — tests prove behavior, evals prove quality didn't regress.

### 1c. Skill-output tests

- Each derivation skill (2a–2f) needs a fixture: a sample raw input + expected proposal output.
- Not strict diff matching — too brittle — but assertions like "proposal count in range [1,5]", "every proposal cites a wiki slug", "no dup against seeded todo.md".
- Run as part of `bun test`; skip when no synthesis provider is configured.

## 2. Skills library & extensibility

**This is the product.** gbrain runs 25 skills through a `RESOLVER.md` dispatcher; mm has 6 today. The skill set defines what mm can *do* — new skills are features, not refactors. "Thin harness, fat skills" is the operating principle.

Two skill families:

### Derivation skills — extract artifacts from conversation

Each `derive-*` skill takes an **opinionated input** (research source, exit interview, chat transcript, post-mortem) plus the project's current state, and produces **grounded, de-duped, diff-style proposals** for one target artifact file. Same shape, different targets.

#### 2a. `derive-todos` → `agent/docs/todo.md`

**Shipped** as `meta/skills/derive-todos.md` (2026-04-18). Extracts proposed todo additions from any opinionated source. Source-type agnostic:

- `research` — architecture/feature proposals from external projects (LLM_Wiki, GBrain, etc.).
- `exit-interview` / `chains` — agent handoffs proposing project changes. **This is the self-evolution loop**: agent finishes → writes what they want changed → `derive-todos` turns opinions into grounded actions → next agent reads updated todo.
- `docs` / raw — user feedback, post-mortems, bug reports.

Followups:

- Add `source_type='exit-interview'` to the taxonomy. Wire ac's exit-interview capture into an mm import pipeline — one raw file per interview.
- Wire `derive-todos` into the ingest flow for opinionated sources: when `source_type ∈ {research, exit-interview, post-mortem}`, chain a `derive-todos` pass after `ingest`. Skip for neutral sources (`claude`, `telegram`, `docs`).
- Expose as `bun run brain derive-todos <wiki-slug>` for post-hoc runs against earlier ingests.
- Make it a citizen of the briefing preamble (4c) — briefed session already has todo + roadmap + schema + remaining-gaps loaded.

#### 2b. `derive-bugs` → `agent/docs/bugs.md`

Extract surfaced defects from sessions: "thing X didn't work", "schema v4 migration had an issue with Y", "the embed step failed on Z." Output one entry per distinct bug with: symptom, reproduction context, where in the code it surfaces, severity guess. De-dup against existing bugs.md. Source-type inputs: `claude` (session transcripts are rich with bug evidence), `exit-interview`, user feedback.

#### 2c. `derive-corrections` → `agent/docs/corrections.md`

Extract lessons-learned from conversation: "I was wrong about X, the correct version is Y", "we assumed A, but measurement showed B." Each entry has: the false assumption, the corrected version, the source. This is the **mistakes library** — a deliberate artifact to prevent repeating mistakes across sessions. Newer corrections supersede older ones; derive-corrections keeps the supersession chain visible.

#### 2d. `derive-decisions` → `agent/docs/decisions.md`

Extract decisions from conversation: what was chosen, what was rejected, why. Each entry: decision, alternatives considered, rationale, date, source. The **decision log**. Critical for explaining *why* the system looks the way it does to future agents and contributors. Much cheaper to maintain than hand-written ADRs.

#### 2e. `derive-skipped` → `agent/docs/skipped.md`

Cross-references conversation transcripts against `todo.md` history to find **todos that were set but never touched**. Example: "we said we'd add streaming but three sessions passed and it's still not done." Output: todo entry, when first raised, times it was mentioned since, likely reason for skipping (too big? forgotten? blocked by X?). Surfaces aging items for conscious triage — either do them, re-prioritize them, or explicitly drop them.

#### 2f. `derive-friction` → `agent/docs/friction.md`

Extract **repeated pain points** across sessions: "agent complained about cold-start context three times", "the ingest skill log-write gets skipped on every other pass." Pattern-matching on recurring complaints. Output: pattern description, frequency, sessions where it appeared. Feeds into prioritizing skill/infrastructure fixes.

### Maintenance skills — keep the brain healthy

These run on the existing corpus rather than extracting from new input.

#### 2g. Citation-fixer as its own skill

- Today `brain dream` does edit-distance repair on broken `[[wiki]]` links embedded inside its maintenance pass.
- Promote it to `meta/skills/citation-fixer.md` + a `bun run brain fix-citations` command. Dream calls the skill; it can also be invoked manually. Cleaner separation.

#### 2h. Always-on signal detector

- gbrain runs a parallel "signal detector" on every raw write — extracts entities and ideas without blocking. Feeds downstream ingest with hints.
- For mm: a small pass that runs inside `addToBrain` (or as a hook after) that produces a one-line summary + extracted entity list, stored on `raw_entries` as metadata columns. Makes later ingest faster and more consistent.

#### 2i. Tier auto-promotion with fail-improve loops

- mm has the `tier` column (1=High, 2=Standard, 3=Stub) but promotion is manual in the `dream` pass.
- gbrain pattern: T3 → T2 after N distinct sources, T2 → T1 after M sources or after meeting/long-form mention.
- Add a classifier that predicts tier from `(source_count, mentions, has_cross_refs, depth_of_summary)`; when it disagrees with the human-assigned tier, log the case to `meta/evals/tier-disagreements.md`. Over time, the classifier improves against real disagreements — gbrain calls this "fail-improve."

#### 2j. Research recipes (YAML extraction specs) — plugin surface

- gbrain has `research init` that scaffolds YAML recipes describing how to extract structured data from a source type (email, meeting, article, PDF).
- For mm: `meta/recipes/<name>.yaml` declares "for source_type X, extract fields {a, b, c} and map to wiki fields {…}." Importers consult recipes; users can add their own without touching code.
- This is the real plugin surface for custom source types — beats hardcoding per-importer logic in TS.

### Cross-cutting: the derivation-skill contract

All `derive-*` skills share structure (documented canonically in `meta/skills/derive-todos.md`):

1. Read the source + current artifact file + project context files (`schema.md`, `roadmap.md`, `remaining-gaps.md`).
2. Extract candidate items from the source.
3. Filter for project-applicability and dedup against current artifact.
4. Map each item to an existing section or flag as new.
5. Ground every proposal with a wiki-slug citation + target file/section.
6. Output diff-style; do NOT edit the artifact file directly.
7. Reject ideas explicitly with one-line reasons (data for future passes).
8. Log a one-line summary to `meta/log.md`.

When we write `derive-bugs`, `derive-corrections`, etc., they follow this same template — only the target artifact and extraction focus differ.

### Orchestration — running skills at scale

Skills are the product; this subsection is how they actually get invoked in production. Informed by direct experience: `brain process` already iterates `WHERE processed = 0`, so batch ingestion is a solved primitive — what's missing is the operational harness around it.

**Synthesis mode decision: `-p` only.** No interactive sessions for production runs. All skill invocations go through one-shot `gemini -p` (or provider equivalent). Deterministic, scriptable, crontab-friendly. Interactive mode remains a dev tool for skill prototyping only.

#### Git-aware `raw/`

- `git init raw/` with a baseline commit. Commit = "batch ingested." Staged = "in flight." Untracked/modified = "pending."
- Combine with **stable-filename-per-session**: `raw/claude/mm/<session-id>.md` instead of timestamp-per-import. Re-imports overwrite the same file; `git diff` gives the per-file delta. Gemini processes diffs, not whole files. Massive token savings on growing session transcripts.
- `processed=1` flag in SQLite becomes redundant (or a derived cache) — git log is authoritative. One state system, not two.

#### Batching

- `brain process` today processes one raw entry per Gemini call. Extend with:
  - `--batch N` — group N raw entries into one Gemini `-p` call (amortizes the skill+schema preamble across entries).
  - `--source-type X` / `--project Y` — filter the queue so cron jobs can target specific streams independently.
  - `--dry-run` — list entries that would be processed, skip Gemini.
- Sweet spot around `--batch 10`, per empirical data (1 session ≈ 3% of Gemini's context window).

#### Declarative orchestration config (`meta/config.toml`)

**Manual cron lines rot.** Users don't maintain them, LLMs can't inspect or mutate them safely, and one forgotten line silently breaks the auto-ingest promise. Replace the entire manual layer with a declarative config that both humans and LLMs can read and write.

**Format.** TOML at `meta/config.toml` — ships with the brain root, diffable, human-friendly, Rust-native for Hardcore. Example shape:

```toml
[[imports]]
name          = "mm-claude-daily"
source_type   = "claude"
project       = "mm"
schedule      = "0 9 * * *"          # cron expression, local TZ
importer      = "scripts/import-claude.ts"
args          = ["--days", "1", "--project", "mm"]
post_ingest   = ["derive-todos"]     # chain after `brain process`

[[imports]]
name        = "research-inbox-watch"
source_type = "research"
project     = "mm"
watch_dir   = "~/research-inbox"     # alternative to schedule: fs watcher
post_ingest = ["derive-todos"]

[ingest]
batch_size   = 10                    # entries per `brain process` call
embed_after  = true

[synthesis]
provider = "gemini"
model    = "gemini-2.5-pro"
timeout  = 180
```

**Scheduler.** `bun src/scheduler.ts` runs as a long-lived process (started by `run.command` or launchd on macOS / systemd on Linux), parses `meta/config.toml`, fires jobs at scheduled times. On file change → hot-reload, no restart. Each run appends a one-line entry to `meta/log.md`. Failed runs get retried with backoff, not silently dropped.

**Settings UI.** New **Settings** view in `ui/index.html`:

- Form-driven list of imports with Add / Edit / Remove / Enable-toggle. Schedule picker, source_type enum, project free-text, post_ingest multi-select.
- "Raw TOML" textarea for power users who prefer direct editing — validates on save.
- Everything goes through `/config` HTTP API so validation is authoritative server-side.

**LLM / MCP surface.** So `derive-friction` can propose "your Claude import runs too often, reduce to every 3h" and the LLM can actually carry the change out:

- `GET /config` — returns current TOML + parsed JSON.
- `PUT /config` — validates, writes TOML, triggers scheduler reload.
- MCP tools: `list_imports`, `add_import`, `update_import`, `remove_import`, `enable_import`, `disable_import`. Scoped behind a capability flag so not every client can mutate scheduling.

**Validation.** JSON schema for the TOML; invalid configs rejected with clear errors. Ship `meta/config.example.toml` as the reference. First-run bootstrap copies example → config if config absent.

**Boundaries.** The scheduler does NOT do ingestion work itself — it invokes existing scripts + `brain process` + `brain derive-todos` + `brain embed`. Keeps the scheduler focused on timing + config + logging, leaves ingestion logic where it already lives.

**Canonical job shape** (what each scheduled run executes internally):

```sh
<importer>  <args...>                                      # fetch source → raw/
git -C raw add . && git -C raw commit -m "ingest: <name>"  # git-aware batch identity
bun run brain process --source-type <src> --batch <N>      # skill-driven ingest
bun run brain embed                                        # refresh vectors
<for each post_ingest step> bun run brain <step>           # derive-todos / derive-bugs / etc.
```

This replaces `agent/docs/how-to-cron.md` as a manual-crontab guide. The doc that ships instead is `agent/docs/how-to-schedule.md` — how to *configure* imports via the UI or TOML, not how to write crontab lines.

#### Sources to wire up (targets for the config above)

- `claude` — `scripts/import-claude.ts --days 1 --project <slug>` hourly or daily.
- `telegram` — importer pending (legacy script needs source_type/project update per `how-to-import.md`).
- `chains` — ac chain messages → `raw/chains/<project>/`. Needs a small exporter on the ac side.
- `docs` / `research` — filesystem watchers on user-configured directories (per `watch_dir` in config).

#### Provenance check — resolve the claim_sources gap

Today `brain process` errors if wiki files change without `claim_sources` rows. Gemini running direct-write skills (the actual practice) bypasses `brain page create`, so `processed=1` never flips and the queue grows forever. Two paths:

- **Option A (preferred, aligns with reframing).** Accept Timeline citations as sufficient provenance. `brain process` scans wiki pages modified during the run; if any Timeline bullet cites the raw entry's path, the entry is considered provenance-linked and marked processed. Markdown is the source of truth — it already has the provenance, we just read it back.
- **Option B.** Mandate `bun run brain page create/update --source N --claim "..."` in the ingest skill so `claim_sources` is always populated. More brittle (depends on Gemini following instructions); aligns with current code.

Option A also backfills the currently-stuck entries (the four wiki pages from earlier ingest runs cite their raw paths correctly).

## 3. Refactor

### 3a. Readability pass on `src/brain.ts`

No logic changes. Pure formatting.

- Break up dense multi-statement one-liners (examples: ~L287, L292–293, L297, L303–309, L312).
- One statement per line, normal indentation.
- Keep commander action callbacks as-is shape, just expand their bodies.

### 3b. Architectural refactor

Only after 1, 2, and 3a.

- Move `internalRebuildIndex`, `internalRebuildMarkdownIndex`, `internalRebuildTimeline`, `internalRecordClaim` from `src/brain.ts` into `src/core.ts`. They're pure logic, not CLI glue.
- Consider splitting `src/core.ts` if it passes ~20KB: likely seams are `core/db.ts`, `core/search.ts`, `core/ingest.ts`, `core/embed.ts`. Don't split preemptively.
- Keep `src/brain.ts` as thin CLI wiring only (commander + argument parsing).
- **Pluggable storage trait** (gbrain-inspired): design the DB-facing API as an interface — `Store` with methods for raw entries, wiki pages, chunks, claims, search — with a single `SqliteStore` impl behind it for now. Pays off for the Hardcore migration (swap to tabularium or pgvector with the rest of the code unchanged) and for future bidirectional migration between local SQLite and a hosted backend. gbrain ships PGLite↔Supabase swap as a real feature.

## 4. External-dependency hygiene

Makes mm usable as a real plugin surface and fixes the biggest UX problem: `/query` latency. Also prerequisite for the derivation-skill family (they all need a synthesis provider call).

### 4a. Provider abstractions

- Abstract Ollama behind an `EmbeddingProvider` interface (currently hardcoded to `localhost:11434` in `src/core.ts::embedBrain`).
- Abstract Gemini behind a `SynthesisProvider` interface (currently hardcoded `Bun.spawn(['gemini', ...])` in `runGemini`).
- Configurable via env: `MT_EMBED_URL`, `MT_EMBED_MODEL`, `MT_SYNTH_PROVIDER` (`gemini`|`ollama`|`anthropic`|`openai`), `MT_SYNTH_MODEL`.
- Multiple synthesis providers matter — Gemini CLI was taking 2–3 min for a single answer in testing, which is unusable interactively. A local Ollama synthesis option is the obvious fallback; a direct Anthropic API option is the interactive-quality option.

### 4b. Streaming `/query`

High priority — this is the single biggest UX win for the UI.

- Change `runGemini` (and any successor providers) to stream tokens instead of returning a completed string.
- `api.ts` `/query` endpoint should respond with a streamed `text/markdown` body (or SSE, but chunked transfer is simpler and the UI can progressively render).
- UI already handles the "render on complete" path; update the fetch to `ReadableStream` consumption and re-render `x-html` as tokens arrive.
- When streaming lands, remove the `idleTimeout: 180` workaround in `api.ts` — keep-alive frames from the provider will keep the connection warm.

### 4c. Briefing-based synthesis (ac-style)

Loading the full `skill + schema + context` preamble on every call is wasteful and slow. `ac/` solved this with the briefing protocol: brief the provider once with the stable preamble, capture a session id, reuse via resume on every call. Per-call payload becomes only `{retrieved context + user question}`.

Plan:

- One-time briefing at provider init:
  - Compose preamble: `meta/skills/query.md` + `meta/schema.md` + output contract ("markdown, ≤200 words, cite sources at the end of sentences in parentheses or in a trailing Sources list — never inline as running text; use `[[Slug|Title]]` or `raw/filename.md`; answer in one sentence if no evidence").
  - Submit via the provider in a mode that returns a session handle (`claude -p --output-format stream-json` captures session_id from the `system/init` event).
  - Persist the session id in `meta/brain.db` (new `synthesis_sessions` table: `provider, model, session_id, preamble_hash, created_at`).
- Per-call query:
  - Resume the session (`claude -p --resume <sid>` or provider-equivalent), send only retrieval context + user question.
  - If the preamble hash drifts (skill/schema changed on disk), auto-rebrief once before the call.
- Fallbacks:
  - If provider doesn't support sessions, fall back to full-preamble mode and log a warning in `meta/doctor-report.md`.
  - Gemini CLI does not natively support resume — that alone is a reason to prefer Claude-CLI or a direct-API provider for the synthesis path.

**Reuse from ac/, do not reinvent.** Port the patterns and, where feasible, lift the code:

- `ac/agent/scripts/brief.ts` — canonical brief script: composes preamble, captures `session_id` from stream-json. Reference implementation for `briefProvider`.
- `ac/src-server/llm/sessions.ts` — save/resume mechanics. mm needs the session-row shape, not the full participant model.
- `ac/product-dist/agent/code-docs/protocols/briefing-protocol.md` — protocol spec with hazards section (active-session races, double-briefing, label-mismatch bug).
- `ac/src-server/llm/` CLI provider — `claude -p` subprocess wrapper with stream-json parsing.

What does NOT apply to mm: participant panes, chains, `clean_participant`, terminal provider, REQUEST_RELAUNCH.

### 4d. Remaining prompt-composition gaps (secondary to 4c)

- No per-page truncation — a large wiki page inlined in full dominates the prompt. Cap at ~800 chars per page with an ellipsis.
- Trailing instruction in `src/core.ts::queryBrain` duplicates `meta/skills/query.md`'s citation rule. Fold into the skill or drop after the briefing rework.

### 4e. Already done this session

- `runGemini` migrated from `execFileSync` to async `Bun.spawn` so HTTP handlers no longer block the event loop.
- `api.ts` got `idleTimeout: 180` so long Gemini runs don't get killed at 10s.

## 5. Retrieval quality

Goal: the LLM sees better, tighter, more relevant context so answers are stronger and faster without swapping to a bigger synthesis model. Every item here compounds with 4c (briefing): smaller per-call payload means higher information density per token.

Ordered roughly by value-per-effort.

### 5a. Smarter chunking (no new deps)

- Today `queryBrain` inlines the **full body** of the top-3 wiki pages. A single long page drowns the rest of the context window.
- Chunk by `##` section and by claim. Cap each chunk at ~800 chars. Inline the top 5–10 chunks instead of 3 full pages.
- The `chunks` table already exists; extend `embedBrain` to populate section-level chunks alongside the current `wiki_truth` chunks.
- Extend to **raw-chunk embedding**: today `embedBrain` only creates wiki chunks, so freshly imported raw entries are invisible to vector search until they're ingested into wiki. Adding raw-side sliding-window chunking gives us queryable raw content with no ingest dependency.
- Deterministic, reversible, measurable — exactly the kind of change that belongs right after tests land.

### 5b. Reranking + semantic dedup (uses 4a provider abstractions)

- After `hybridSearch` returns top-N, **semantic-dedup** first: collapse chunks whose cosine similarity exceeds ~0.9 into one (keep the higher-ranked one). wizrag-inspired — catches "same idea, rephrased" duplicates that content-hash dedup misses.
- Then **rerank** with a small cross-encoder (local via Ollama) or a dedicated rerank call: "score 0–10 how well each chunk answers the question."
- Cut to top-K (e.g. 5) before stuffing the synthesis prompt.
- Biggest single quality win available at the retrieval layer — changes *what the LLM sees* much more than tweaking the index ever will.

### 5c. Field-weighted BM25

- Title hits should rank above body hits; alias hits should rank above raw-snippet hits.
- FTS5 `bm25(tbl, wTitle, wBody, …)` takes column weights — set them when building the `MATCH` query in `hybridSearch`.
- Low effort, clear gain on entity-lookup queries.

### 5d. Intent classification + multi-query expansion (gbrain-inspired)

Three composable moves that together lift retrieval quality on ambiguous questions. All use a small fast model (Haiku / local Ollama) via the 4a provider abstraction — not the synthesis model.

- **Intent classification.** Before `hybridSearch`, classify the question as `entity` | `temporal` | `event` | `general`. Branch: entity queries boost FTS on title/aliases; temporal queries filter by date range (Timeline bullets are dated); general queries take the full hybrid path. `meta/skills/query.md` already names the categories; what's missing is a deterministic classifier step that dispatches on them.
- **Multi-query expansion.** For each question, the classifier model also emits 2–4 paraphrases covering vocabulary variants. Run all through hybrid search, merge results via RRF.
- **HyDE for vague questions.** For `general` intent only, generate a short hypothetical answer, embed it, add to the vector search alongside the raw query and the expansions.

Needs 4b streaming so the extra round-trip to the small model doesn't become visible latency.

## 6. Public-release polish (owner decisions)

Not devops calls. Listed so we don't forget.

- Choose a license.
- Decide whether to scrub the sample brain content in `raw/` and `wiki/` (currently personal data).
- Parameterize or delete `scripts/import-chats.ts` — it has a hardcoded personal path.
- Version-tag a public 0.1 of **Mnemonic Light** — the TS/Bun standalone + ac-plugin shipment. Release proves the methodology; Hardcore can come later.
- Decide whether `meta/skills/*.md` stays in repo or ships as a user-extensible template (2j pushes toward "user-extensible").

## 7. Mnemonic Hardcore — Rust migration (deferred)

**Deliberately last.** Hardcore is a scaling concern, not a product concern. It only makes sense after Light has proven the methodology — skills shipped, tests green, retrieval-quality evals stable, a 0.1 release out the door.

### Why deferred

mm's value lives in the skill library and the ingestion practices (step 2), not in the runtime. A Rust migration before methodology stabilizes would optimize the wrong thing. Skills-first validates that "LLM-mediated extraction with markdown artifacts" is a useful primitive at all; if so, Hardcore is a natural scaling migration; if not, Hardcore would have been wasted work.

### Two existing codebases cover the substrate

Not a from-scratch rewrite — an assembly on top of:

- **ac's Rust + Tauri shell** — app frame, windowing, dock, theme system, Alpine app hosting, MCP wiring. See `ac/src-server` and `ac/ui`.
- **[tabularium](https://github.com/eva-ics/tabularium)** (Apache-2.0) — markdown document store with Tantivy full-text search, SQLite, embedded web UI, REST, JSON-RPC, MCP, `tb` CLI. Nearly the exact substrate Hardcore was describing. Available as library crate, server, and CLI.

ac's shell + tabularium's store = chassis. mm's distinctive work (claims + provenance + hybrid retrieval with embeddings + briefings + maintenance skills) sits on top.

### What mm keeps owning

- Claims + provenance (`claims`, `claim_sources`, `wiki_links` tables) — every wiki statement traceable.
- Hybrid retrieval with embeddings — FTS5/Tantivy + vector via RRF, then rerank (5b).
- Synthesis briefings (4c) — stable-preamble session reuse.
- Maintenance + derivation skills (step 2) — the product.
- The specific data model — compiled truth vs timeline, tiers, aliases, source_count.

### Open decisions before committing to tabularium

1. **Data-model fit.** tabularium is a markdown directory tree; mm is a flat slug + frontmatter model with claims and provenance edges. Does mm's schema map onto tabularium's document + metadata model, or do we need sidecar tables for claims/links? Inspect tabularium's schema + REST API first.
2. **Integration shape.** Library crate (tightest, single binary) vs HTTP client against `tabularium-server` (looser, two processes, easier to swap later, can share store with `tb` and the web UI). Library first-pass; service as fallback.
3. **Platform coverage.** tabularium's current prebuilt is Apple Silicon only. Hardcore's public direction wants Linux + Intel macOS too.

### Vector slot

Today mm brute-forces cosine in JS. Under Hardcore, use an **HNSW**-backed vector index (O(log n) search): either `sqlite-vec` for the Light→Hardcore bridge, or tabularium's native vector slot, or a dedicated `hnswlib` crate. gbrain runs pgvector with HNSW on 17k+ pages — known to scale. Fits the pluggable-storage trait from step 3: `VectorIndex` is a method on `Store`.

### Migration shape

1. Stand up a Rust workspace parallel to the TS code.
2. Adopt ac's shell as the app frame.
3. Bring tabularium in at the library or service layer (per decision 2).
4. Port mm's claim/provenance tables as sidecar SQLite tables alongside what tabularium manages.
5. Port hybrid retrieval on top of tabularium's Tantivy search.
6. Port synthesis briefings + maintenance loops + derivation skills.
7. Validate each port against the behavior-level test suite from step 1 — tests define correctness regardless of language.
8. Flip default runtime; keep TS code around one release as fallback; then remove.

5a–5d from step 5 stay relevant throughout — they operate on retrieval output, not inside the text-search engine.

**Gate:** do not start until 1–6 are done. Tests are the bridge that lets us swap the engine without silent regressions; briefing (4c) is what makes the Rust synthesis provider tractable; evals (1b) prove quality didn't regress; the skill library (step 2) defines *what* is being ported in the first place.

## UI followups (low priority)

The UI (`ui/index.html`) shipped intentionally minimal.

- Stream rendering once `/query` streams (see 4b).
- Token-based theme (split aurora palette into `ui/styles/tokens.css` + `themes/*.css` like `ac/ui` does).
- Render wiki page titles from frontmatter instead of the slug fallback.
- Surfaces for the new artifact files (bugs/corrections/decisions/skipped/friction) — one tab per, once 2b–2f ship.
- Automated UI smoke test via `claude-in-chrome` MCP once available.

## Parallel track — ac plugin packaging (Mnemonic Light inside ac)

Not blocked by the numbered sequence. Small scope; validates the plugin-surface promise.

- Package `ui/index.html` as an ac Holo app (`ac/ui/apps/mm.html`). Alpine conventions already match ac's contract; swap the inline `<style>` block for ac tokens from `ui/styles/contract.css`.
- Expose mm's MCP surface (`src/mcp.ts`) as an ac-participant tool so ac agents can query the brain via the shared MCP pipe.
- Decide how ac and mm share the brain root: HTTP to mm's running API (cheap first pass), or wire directly to `core.ts` (requires mm-as-library, bigger).
- Keep the standalone repo functional — plugin is an additional shipping mode, not a replacement.

## Non-goals (deliberately skipping)

- Piecemeal language swaps. The Rust migration is a planned single pass (step 7) — not a sneak-in during a refactor or test round.
- Swapping SQLite wholesale. SQLite stays for provenance, queue, and vector store even under Rust + Tantivy.
- Adding feature scope before step 6 is done. Everything past that gates on actual usage of Light in the wild.

## References

Prior art and inspiration. **These now live in the brain as canonical wiki pages** — reference them through the brain, not the web, so future agent sessions can retrieve them via `/query` instead of re-fetching.

- **[[LLM_Wiki|LLM Wiki]]** (Karpathy's gist — `raw/research/mm/2026-04-18-karpathy-llm-os.md`) — the three-layer (raw/wiki/schema), LLM-maintained-wiki pattern mm is built on. Validates direction; no new tech to lift.
- **[[Cross_Chat_Knowledge_Base|Cross-Chat Knowledge Base]]** (wizrag — `raw/research/mm/2026-04-18-wizrag-cross-chat.md`) — semantic dedup before embed (5b); LLM decides what to save (validates mm's skill-driven ingest); single-URL/GET cross-platform save pattern.
- **[[GBrain]]** (Garry Tan — `raw/research/mm/2026-04-18-gbrain.md`) — the most mature production instance. Sources for: eval harness (1b), pluggable storage trait (3b), intent classification + multi-query expansion (5d), HNSW vector index (7), tier auto-promotion (2i), signal detector (2h), research recipes (2j), "thin harness, fat skills" framing (section 2 as a whole).

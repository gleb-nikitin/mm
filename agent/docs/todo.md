# Todo

Rolling list of deferred work. Rewrite when it drifts — don't append forever. Keep each entry small enough that a future session can pick it up without needing to rediscover the context.

## Sequence

Do them in this order. Each step unblocks the next.

1. **Tests** (blocks everything else)
2. **Readability pass on `src/brain.ts`**
3. **Architectural refactor**
4. **External-dependency hygiene**
5. **Retrieval quality**
6. **Public-release polish** (owner decisions)

## 1. Tests

Goal: enough safety net that the refactor can't silently change behavior.

- Write **behavior-level** tests only (CLI commands, HTTP endpoints, MCP tool calls). No unit tests against internal helpers — those couple to the current shape and block refactor.
- Boot each test against a fresh `MT_BRAIN_ROOT` in a temp dir with empty `raw/ wiki/ meta/`.
- Minimum suite:
  - fresh-root bootstrap creates schema v3
  - `POST /add` (or CLI `add`) writes a raw file and bumps `/stats`
  - `search`, `query`, `validate`, `doctor`, `lint`, `dream` run to completion on a small seeded brain
  - MCP `search_brain` / `query_brain` / `brain_stats` return expected shapes
- Stub or mock Ollama and Gemini — the real calls are too slow and non-deterministic for a test suite.
- Pick a test runner: `bun test` is the obvious default (no extra deps).

## 2. Readability pass on `src/brain.ts`

No logic changes. Pure formatting.

- Break up dense multi-statement one-liners (examples: ~L287, L292–293, L297, L303–309, L312).
- One statement per line, normal indentation.
- Keep commander action callbacks as-is shape, just expand their bodies.

## 3. Architectural refactor

Only after 1 and 2.

- Move `internalRebuildIndex`, `internalRebuildMarkdownIndex`, `internalRebuildTimeline`, `internalRecordClaim` from `src/brain.ts` into `src/core.ts`. They're pure logic, not CLI glue.
- Consider splitting `src/core.ts` if it passes ~20KB: likely seams are `core/db.ts`, `core/search.ts`, `core/ingest.ts`, `core/embed.ts`. Don't split preemptively.
- Keep `src/brain.ts` as thin CLI wiring only (commander + argument parsing).

## 4. External-dependency hygiene

This is the step that makes Mnemonic51 usable as a real plugin surface. It also fixes the biggest UX problem: `/query` latency.

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

### 4c. Briefing-based synthesis (the real fix, ac-style)

Loading the full `skill + schema + context` preamble on every call is wasteful and slow. `ac/` solved this with the briefing protocol (`ac/product-dist/agent/code-docs/protocols/briefing-protocol.md`): brief the provider once with the stable preamble, capture a session id, reuse via resume on every call. Per-call payload becomes only `{retrieved context + user question}`.

Plan:

- One-time briefing at provider init:
  - Compose preamble: `meta/skills/query.md` + `meta/schema.md` + output contract ("markdown, ≤200 words, cite sources at the end of sentences in parentheses or in a trailing Sources list — never inline as running text; use `[[Slug|Title]]` or `raw/filename.md`; answer in one sentence if no evidence"). The inline-citation rule matters: observed Gemini output "likes hiking [[Hiking|Hiking]]" renders as "likes hiking Hiking" after wikilink substitution, which reads awkwardly.
  - Submit via the provider in a mode that returns a session handle (`claude -p --output-format stream-json` captures session_id from the `system/init` event — that's the pattern ac uses at `brief.ts`).
  - Persist the session id in `meta/brain.db` (new `synthesis_sessions` table: `provider, model, session_id, preamble_hash, created_at`).
- Per-call query:
  - Resume the session (`claude -p --resume <sid>` or provider-equivalent), send only the retrieval context + the user question.
  - If the preamble hash drifts (skill/schema changed on disk), auto-rebrief once before the call.
- Fallbacks:
  - If the active provider does not support sessions, fall back to full-preamble mode and log a warning in `meta/doctor-report.md`.
  - Gemini CLI does not natively support resume — that alone is a reason to prefer Claude-CLI or a direct-API provider for the synthesis path.

This is the ac-parallel pattern: briefings in ac are to agents what preambles are to the synthesis provider here. Same idea, same ownership of the "stable context" contract.

**Reuse from ac/, do not reinvent.** ac has shipped and debugged this exact machinery — port the patterns and, where feasible, lift the code with attribution:

- `ac/agent/scripts/brief.ts` — the canonical brief script: composes preamble, invokes `claude -p --output-format stream-json`, captures `session_id` from the first `system/init` event. This is the reference implementation for our `briefProvider` function.
- `ac/src-server/llm/sessions.ts` — save/resume mechanics. mm doesn't need the full participant model, just the "session row with label and provider metadata" shape.
- `ac/product-dist/agent/code-docs/protocols/briefing-protocol.md` — the protocol spec. Read before implementing; the hazards section (active-session races, double-briefing, label-mismatch bug) saves us from repeating ac's debugging tour.
- `ac/src-server/llm/` (CLI provider) — the `claude -p` subprocess wrapper with stream-json parsing. Port the parse loop; drop anything tied to ac's participant/chain model.

What does **not** apply to mm: participant panes, chains, `clean_participant`, three-gate refuse predicate, terminal provider, REQUEST_RELAUNCH flow. Those solve ac-specific problems that mm doesn't have. Take the session + briefing pattern, leave the participant infrastructure.

### 4d. Remaining prompt-composition gaps (secondary to 4c)

These still apply regardless of briefing — they live in whatever the per-call payload looks like.

- No per-page truncation — a large wiki page inlined in full dominates the prompt. Cap at ~800 chars per page with an ellipsis.
- Trailing instruction in `src/core.ts::queryBrain` duplicates `meta/skills/query.md`'s citation rule. Fold into the skill or drop after the briefing rework.

### 4e. Already done this session

- `runGemini` migrated from `execFileSync` to async `Bun.spawn` so HTTP handlers no longer block the event loop.
- `api.ts` got `idleTimeout: 180` so long Gemini runs don't get killed at 10s.

## 5. Retrieval quality

Goal: the LLM sees better, tighter, more relevant context so answers are stronger and faster without swapping to a bigger synthesis model. Every item here compounds with 4c (briefing): smaller per-call payload means higher information density in whatever tokens we do spend.

Ordered roughly by value-per-effort. 5a–5d work on the current SQLite + FTS5 + vector stack; 5e is the Rust-shell migration.

### 5a. Smarter chunking (no new deps)

- Today `queryBrain` inlines the **full body** of the top-3 wiki pages. A single long page drowns the rest of the context window.
- Chunk by `##` section and by claim. Cap each chunk at ~800 chars. Inline the top 5–10 chunks instead of 3 full pages.
- The `chunks` table already exists; extend `embedBrain` to populate section-level chunks alongside the current `wiki_truth` chunks.
- Deterministic, reversible, measurable — exactly the kind of change that belongs right after tests land.

### 5b. Reranking (uses 4a provider abstractions)

- After `hybridSearch` returns top-N, rerank with a small cross-encoder (local via Ollama) or a dedicated rerank call on the synthesis provider: "score 0–10 how well each chunk answers the question."
- Cut to top-K (e.g. 5) before stuffing the synthesis prompt.
- Biggest single quality win available at the retrieval layer — changes *what the LLM sees* much more than tweaking the index ever will.

### 5c. Field-weighted BM25

- Title hits should rank above body hits; alias hits should rank above raw-snippet hits.
- FTS5 `bm25(tbl, wTitle, wBody, …)` takes column weights — set them when building the `MATCH` query in `hybridSearch`.
- Low effort, clear gain on entity-lookup queries.

### 5d. Query expansion / HyDE for vague questions

- For conceptual or open-ended questions, generate a short hypothetical answer first (via the synthesis provider), embed *that*, and use it for the vector search alongside the raw query.
- Big recall improvement on "what do we know about X" style queries where the literal question words barely appear in the corpus.
- Needs 4b streaming to hide the extra round-trip.

### 5e. Mnemonic Hardcore — Rust track, standing on two existing codebases

The Rust track (named **Mnemonic Hardcore** in the roadmap) is **not** a from-scratch rewrite. Two existing, production-grade Rust codebases already cover the pieces mm was going to build:

- **ac's Rust + Tauri shell** — window management, dock, shell strip, theme system, Alpine apps, MCP wiring. Reuse as the app frame. See `ac/src-server` and `ac/ui`.
- **[tabularium](https://github.com/eva-ics/tabularium)** (Apache-2.0, by a friend of the owner) — **markdown document store with Tantivy full-text search, SQLite backing, embedded web UI, REST, JSON-RPC, MCP, and a `tb` CLI.** This is almost exactly the substrate step 5e was describing. Available as:
  - library crate `tabularium`
  - service `tabularium-server`
  - CLI `tabularium-cli`

In short: ac's shell + tabularium's store = the chassis. mm's distinctive work sits on top.

### What mm keeps owning (the actual mm value)

These don't exist in tabularium or ac and are where mm's identity lives:

- **Claims + provenance** (`claims`, `claim_sources`, `wiki_links` tables) — every wiki statement tied to raw sources.
- **Hybrid retrieval with embeddings** — FTS5/Tantivy combined with vector search via RRF, then reranking (5b).
- **Synthesis briefings** (4c) — stable-preamble session reuse for the synthesis provider.
- **Maintenance loops** — `dream`, `doctor`, `lint`, `validate`, tier promotion, citation repair.
- **The specific data model** — `compiled truth` vs `timeline`, tiers, aliases, `source_count`.

### Open decisions before committing to tabularium

1. **Data-model fit.** tabularium is a markdown directory tree; mm is a flat slug + frontmatter model with claims and provenance edges. Does mm's schema map onto tabularium's document + metadata model, or do we need sidecar tables for claims/links? Inspect tabularium's schema + REST API before deciding integration shape.
2. **Integration shape.** Library crate (tightest, single binary) vs HTTP client against `tabularium-server` (looser, two processes, easier to swap later, can share the store with `tb` and the tabularium web UI). Library first-pass; service as fallback if the crate's API is too opinionated.
3. **Platform coverage.** tabularium's current prebuilt is Apple Silicon only. mm's public-repo direction wants Linux + Intel macOS too. Either build from source on those platforms or wait for upstream artifacts.

### Migration shape

1. Stand up a Rust workspace parallel to the current TS code (no deletion yet).
2. Adopt ac's shell as the app frame.
3. Bring tabularium in at the library or service layer (per decision 2).
4. Port mm's claim/provenance tables as sidecar SQLite tables alongside whatever tabularium manages.
5. Port hybrid retrieval on top of tabularium's Tantivy search.
6. Port synthesis briefings + maintenance loops.
7. Validate each port against the behavior-level test suite from step 1 — the tests define correctness regardless of language.
8. Flip the default runtime; keep the TS code around one release as a fallback; then remove it.

5a–5d stay relevant throughout — they operate on retrieval output, not inside the text-search engine.

**Do not start this until steps 1–4 are done.** Tests are the bridge that lets us swap the engine at all without silent regressions; the briefing rework (4c) is what makes the Rust synthesis provider actually tractable.

## 6. Public-release polish (owner decisions)

Not devops calls. Listed so we don't forget.

- Choose a license.
- Decide whether to scrub the sample brain content in `raw/` and `wiki/` (currently personal data).
- Parameterize or delete `scripts/import-chats.ts` — it has a hardcoded personal path.
- Version-tag a public 0.1.
- Decide whether `meta/skills/*.md` stays in repo or ships as a user-extensible template.

## UI followups (low priority)

The UI (`ui/index.html`) shipped intentionally minimal. Future polish:

- Stream rendering once `/query` streams (see 4b).
- Token-based theme (split aurora palette into a `ui/styles/tokens.css` + `themes/*.css` like `ac/ui` does) if we add a second theme or more apps.
- Render wiki page titles from frontmatter instead of the slug fallback.
- Automated UI smoke test via `claude-in-chrome` MCP once available.

## Parallel track — ac plugin packaging (Mnemonic Light inside ac)

Not blocked by the numbered sequence. Small scope; validates the plugin-surface promise of Light.

- Package `ui/index.html` as an ac Holo app (`ac/ui/apps/mm.html` or equivalent). Alpine + Tailwind conventions already match ac's contract; the main work is swapping the inline `<style>` block for ac tokens from `ui/styles/contract.css`.
- Expose mm's MCP surface (`src/mcp.ts`) as an ac-participant tool so ac agents can query the brain via the shared MCP pipe.
- Decide how ac and mm share the brain root: point ac's plugin at mm's running API (`/query`, `/search`, `/wiki`) over HTTP, or wire directly to `core.ts` (requires mm-as-library, bigger). HTTP is the cheap first pass.
- Keep the standalone repo fully functional — the plugin is an additional shipping mode, not a replacement.

## Non-goals (deliberately skipping)

- Piecemeal language swaps. The Rust shell migration is a planned single pass — not a sneak-in during a refactor or test round.
- Swapping SQLite wholesale. SQLite stays for provenance, queue, and vector store even after the Rust + Tantivy migration.
- Adding feature scope before the six numbered steps above are done.

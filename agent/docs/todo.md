# Todo

Rolling list of deferred work. Rewrite when it drifts — don't append forever. Keep each entry small enough that a future session can pick it up without needing to rediscover the context.

## Sequence

Do them in this order. Each step unblocks the next.

1. **Tests** (blocks everything else)
2. **Readability pass on `src/brain.ts`**
3. **Architectural refactor**
4. **External-dependency hygiene**
5. **Public-release polish** (owner decisions)

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

## 5. Public-release polish (owner decisions)

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

## Non-goals (deliberately skipping)

- Rewriting in a different language/runtime.
- Swapping SQLite for anything else.
- Adding feature scope before the five steps above are done.

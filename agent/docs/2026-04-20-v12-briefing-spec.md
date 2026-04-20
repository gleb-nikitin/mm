# Spec: v12 Briefing Surface — CTO session-start preamble (2026-04-20)

**Source:** CTO (`mm_cto`) direct spec. mm's stated product purpose is CTO-seat empowerment — real-time visibility + historical extraction on top of chain dispatches and search. The ingestion half (v11) ships the data; this spec defines the consumer half.
**Owner:** CTO specifies; devops executes.
**Status:** spec only. Gated on the post-v11 ingest-skill tuning pass landing (`agent/docs/2026-04-20-ingest-skill-tuning.md`). The briefing output reflects whatever the artifact corpus contains, so the corpus needs to be tuned first.
**Scope:** v1 is minimal and deterministic. No LLM synthesis. No task-aware relevance. Single project. Session-start preamble only.

---

## Problem

CTO cold-start is the single biggest recurring friction for this seat. Validated today: orientation required reading the v11 plan, both roadmap and todo (stale), per-role handoff files (fragmented), the current code layout, and cross-referencing against the live artifact corpus and git log — ~20 minutes of tax on every cold-start. Most of that information already exists in the DB as artifacts; it's just not delivered in a consumable shape at session boundary.

The artifact corpus (v11) was built to eliminate markdown rot and produce structured, queryable operational memory. Without a briefing surface, the corpus is a write-only store: extracted but never delivered.

## Consumer

**Primary:** `mm_cto` session at cold-start. Loads the briefing output as preamble text into the session prompt.

**Secondary (v1 also serves):** any specialist agent whose cold-start benefits from project context — `mm_devops`, `mm_find`, `mm_audit`. Same surface, same output; agent-role filters are out of scope for v1.

**Deferred:** cross-project CTO view (ac_cto + mm_cto coordination), task-aware relevance (`?task=X`), real-time `list_active_agents` synthesis (separate but adjacent; noted in §Adjacent below).

## Surface

Three equivalent entry points:

- **HTTP:** `GET /brief?project=<slug>` → `text/markdown`.
- **CLI:** `bun run brain brief <project>`.
- **MCP:** `get_brief({ project: <slug> })` → markdown string.

All three call the same core function. Output is markdown, deterministic, identical across surfaces.

## Output shape

One markdown document, target ≤2KB for session-prompt injection without ceremony. Structure:

```markdown
# mm project briefing — <timestamp>

## Health
- Schema: v11
- Artifacts: <N> active (<breakdown by type>)
- Chunks: <processed>/<total>
- Raw events: <N>

## Active agents
- <participant_id> · <project> · <age> · doing: <last-turn-one-liner>
(or: "No agents active in last 5 minutes.")

## Intents (<N>)
- [<horizon>] <statement> (alignment: <alignment_check>)

## Open bugs (<N>)
- [<severity>] <symptom> (context: <context?>)
(or: "No open bugs.")

## Recent decisions (last <N>)
- <statement> — <rationale> [<area>]

## Recurring frictions
- <pattern> (<frequency_estimate>, first_seen <date>)

## Corrections above threshold
- was: <previous_belief>; now: <corrected_view> (seen <count>×, last <last_seen>)
(or omitted if none above threshold)

## Recent todos (<N>)
- [<effort>] <statement> [<area>]
```

**Inclusion rules (v1):**
- `intents`: all active, no cap (usually few; if corpus grows unmanageable, sort by `horizon: project > milestone > session` and cap at 10).
- `bugs`: `status != 'fixed'` AND `status != 'wontfix'`. All shown. Sort: `severity: high > medium > low`.
- `decisions`: last 10 active by `created_at` desc.
- `frictions`: sort by `frequency_estimate` (string sort for v1: "Constant > High > Occasional > Once"). Cap at 8.
- `corrections`: `count >= 3` (configurable via env var `MT_BRIEF_CORRECTION_THRESHOLD`, default 3). Sort by `count` desc.
- `todos`: last 10 active by `created_at` desc.
- `future_idea`: not included in v1 briefing. Too noisy; belongs in dedicated ideation surface, not cold-start context.
- `code_doc`, `howto`, `tool_error`, `user_note`, `stack_decision`: not in v1. Add when the tuned corpus has enough of each to matter.

## Empty states

- **Unknown project** (no artifacts, no raw events): return `# <project> briefing — no data yet.` Single line. HTTP 200, not 404 — absence is a valid state in this system.
- **Project exists but section is empty** (e.g. no active bugs): show section header with "(none)" or omit the section entirely. Pick one convention and hold it; v1 default: omit the section for cleanliness.

## Synthesis approach

**v1 is dumb formatting, not LLM synthesis.** Artifacts are already structured data; the briefing is a template render. Reasons:

1. **Deterministic.** Cold-start must produce the same output every time for the same corpus, or debugging "why did I get this briefing" becomes a research project.
2. **Fast.** Session-start injection should take milliseconds, not seconds.
3. **Cheap.** No LLM cost per cold-start; otherwise the "load briefing" step becomes something to optimize around.
4. **Validates the corpus.** If the artifacts are well-extracted, dumb rendering is enough. If rendering looks bad, the problem is upstream (extraction quality), not downstream. LLM synthesis would mask extraction gaps.

LLM synthesis is v2+ territory, when artifact volume per category exceeds cap and we need summarization/ranking.

## Implementation

- **Core:** `src/core.ts::getBrief(project: string): BriefingData` — returns structured object. Separate formatter `renderBrief(data: BriefingData): string` produces markdown. Keeping data and render split makes future surfaces (HTML, JSON) cheap.
- **HTTP:** `src/api.ts` adds `GET /brief` handler. Validates `project` query param; 400 on missing.
- **CLI:** `src/brain.ts` adds `brief <project>` command. Prints to stdout.
- **MCP:** `src/mcp.ts` adds `get_brief` tool. Signature: `{ project: string }` → `{ content: string }`.

Queries for `getBrief` are all SQL over existing `artifacts`, `raw_events`, `chunks_virtual` tables. No schema changes. No new indices (existing `idx_artifacts_project_type` + `idx_artifacts_status` cover the access pattern). `list_active_agents` data is already computed elsewhere — reuse, don't re-implement.

## Adjacent but out of v1 scope

1. **Real-time `list_active_agents` synthesis.** Today's output returns raw `last user turn`. A CTO-shaped version would synthesize the last 3 turns per agent into a one-liner: "devops: harmonizing role.md to committed pattern; about to start A–D skill tuning." Cheap classification with Haiku / local model. Worth building next, but separately from the briefing MVP. See separate spec when ready.
2. **Task-aware relevance (`?task=X`).** Given a task description, return only briefing sections relevant to that task. Needs LLM-side relevance scoring. Useful but premature.
3. **Cross-project view.** ac_cto + mm_cto coordinate on shared infrastructure. A briefing that pulls from both project corpora is valuable but needs project-to-project trust/scope rules.
4. **Briefing-to-ingest convergence.** The "Known Artifacts" block that `process-new.command` injects into the librarian session is the same shape problem at a different phase (ingest-time dedup vs session-start context). At some point both converge on one primitive. Not now.
5. **Per-role briefings.** Devops wants "what's in-flight, what's stashed, what's my current lane"; audit wants "what's pending review, severity-sorted." Same mechanism, different queries. Build CTO v1 first; generalize after.

## Success criteria

**Self-test:** on my next cold-start, after v1 ships, I load `GET /brief?project=mm` and can:
- Name the last 3 decisions that shipped without opening git log.
- Identify current open bugs without grepping the repo.
- See active intents without reading `todo.md`.
- Know which specialists are currently working without running `list_active_agents` separately.

If all four hold, v1 is done. If any miss, the gap is either (a) a data gap (extraction didn't catch something) or (b) a rendering gap (the briefing didn't surface what was there). Log which and iterate.

**Measurable:**
- Briefing output ≤2KB for the current mm corpus.
- Round-trip latency ≤100ms (SQL + format; no network or LLM).
- Empty-project returns clean output, not a stack trace.

## Gates and sequence

1. Ingest-skill tuning pass lands first (chain `wgj`, spec `agent/docs/2026-04-20-ingest-skill-tuning.md`). v12 briefing against the pre-tuning corpus would show the same noise I flagged (72 decisions, duplicate intents). Wait for tuned corpus.
2. Post-tuning corpus read: CTO validates artifact quality is briefing-ready.
3. v12 MVP dispatched per this spec.
4. v12 MVP self-test on next cold-start.
5. Decision gate after self-test: does it solve the cold-start pain? Yes → iterate on §Adjacent. No → diagnose (data gap vs rendering gap) before adding scope.

## Out of scope permanently (not just "later")

- Briefing as a replacement for `agent/roles/<seat>/handoff.md`. Handoff files are CTO-authored narrative about current sharp edges; briefing is DB-rendered state. Both coexist.
- Briefing as a replacement for `CLAUDE.md`. That's the durable project constitution; briefing is operational state.
- Briefing as a replacement for the roadmap. Roadmap is intent; briefing is state. Confusing them degrades both.

## Risks

- **Stale data silently injected.** If artifacts aren't freshly extracted before a cold-start, the briefing reflects old state. Mitigation: header shows latest-raw-event timestamp so the reader sees staleness at a glance.
- **Briefing becomes a crutch that hides extraction gaps.** If the librarian misses corrections, the briefing has no corrections — and the CTO can't tell whether "no corrections" means "nothing to correct" or "extraction failed." Mitigation: during first week of use, cross-check briefing output against the raw artifact list periodically. Trust-but-verify phase.
- **Token budget creep.** 2KB is a v1 cap. Per-section caps exist; total cap isn't enforced. If corpus grows and sections exceed caps, total can balloon. Mitigation: enforce total cap in `renderBrief`; truncate lowest-priority sections last.

## References

- v11 plan (ingestion half that feeds this): `agent/docs/2026-04-20-v11-plan.md` (§"Out of scope" for v12 had the original briefing-protocol stub — this spec replaces and expands).
- Ingest-skill tuning (gates this work): `agent/docs/2026-04-20-ingest-skill-tuning.md`.
- Current artifact types: `meta/skills/ingest.md` §"Artifact types".
- ac's briefing precedent: `ac/product-dist/agent/code-docs/protocols/briefing-protocol.md` (referenced in `todo.md` §4c — similar shape at provider level, not consumer level; useful for cross-session reuse patterns).

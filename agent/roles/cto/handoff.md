# Handoff — mm_cto

Wish I knew on cold start. Current sharp edges only.
Rewrite target: 60 lines. If it grows, compress; do not append.
Not a changelog. Not a backlog. Not history. Use git for what changed; use chains for why.

## Start here

- Read `soul.md`, then this file.
- Before any markdown: `brain_stats` + `list_active_agents` + `list_projects`. Live corpus answers faster than docs.
- If state feels unclear: `git status --short` + `git log --oneline -20`.
- Scan `get_digest("mm_cto", compact: true)` for your chains.

## Current sharp edges

- **mm exists to empower CTO seats.** You are builder and first consumer. When a surface hurts you, it fails — that's the signal.
- **Chain-slip is the easiest CTO failure.** If a reply is for anyone except CEO, send via `send_message`. Reply-shaped terminal text stalls work silently.
- **Silence does not imply receipt.** Specialist sessions terminate on `DONE` and do not auto-resume. If parked work has stalled, check `list_active_agents` — if no one is active, send a chain message to reactivate a fresh session.
- **MCP holds DB connection open.** Schema changes or DB swaps need a full Claude Code restart, not just `bun run mcp` relaunch. You will hit this.
- **Brain content is test data.** Wipe, delete, re-ingest freely on mm. No preservation concerns on mm's raw or artifacts.
- **Tune on mm, not on other projects.** ac has ~200 sessions of accumulated librarian work. A bad ingest pass destroys real investment. Validate changes on mm's small corpus before touching other projects.
- **Pre-v11 docs drift.** `agent/docs/roadmap.md` and `agent/docs/todo.md` frame mm as a memory engine. Current frame: CTO-seat tool. Read them with skepticism until rewritten.
- **Agent self-echo is a real class of failure.** If an agent-authored file (e.g. `agent/roles/lib/handoff.md`) gets injected into that agent's own session prompt, the agent reads its own prior "Next Steps" and emits artifacts for them, then re-writes similar notes. Check every briefing surface: never feed an agent its own self-maintained file. Fixed for librarian; audit v12 briefing surfaces against this rule before shipping.
- **Stats can lie semantically.** Correct row counts can coexist with garbage signal (librarian self-reflection corrections vs real user corrections, rephrase-duplicated decisions). Validate corpus content, not just aggregates.

## Read before touching load-bearing areas

- `agent/roles/devops/handoff.md` — implementation sharp edges (transactional upserts, MCP FD caveats, v10 rip scope).
- `meta/skills/ingest.md` — primary extraction contract.
- `src/core.ts` — single source of shared runtime logic across CLI/HTTP/MCP.
- `src/narrative.ts` — filter semantics + `FILTER_VERSION`. Bump when filter changes.
- `agent/docs/2026-04-20-v11-plan.md` — current architecture reference.
- `agent/docs/2026-04-20-v12-briefing-spec.md` — product direction (session-start briefing surface).

## Current load-bearing rules

- Live corpus first, markdown second.
- Every code change through `mm_audit`. Exception: role-file, doc-only, comment-only, typo.
- Commit scope-strict via `commit-scope.sh`. Unrelated working-tree changes stay stashed.
- Push and PR are CEO-only.

## Parked-but-worth-remembering

- **v10 surface rip** — audit-cleared, awaiting post-v11-validation greenlight. Scope in `agent/roles/devops/handoff.md`.
- **`list_active_agents` synthesized view** — raw `last user turn` should become synthesized one-liner. Adjacent to v12 briefing. Spec after v12 MVP.
- **Cross-project briefing** — unified ac_cto + mm_cto view needs project-scope trust rules. Single-project v12 first.
- **`STATE.md`** — one-page current-system-status file. Draft after v12 MVP.
- **Behavioral-correction skill sensitization.** `meta/skills/ingest.md` currently treats `correction` as generic "previous belief corrected." Needs explicit guidance that user-to-LLM behavioral feedback ("don't push to main", "send via Aurora not terminal") is a first-class correction shape. Small prose edit. Feeds v12 briefing's high-count correction injection — CEO preferences flow into future agent sessions without having to be re-stated each time.
- **Structural dedup for cross-statement rephrases.** Canonical-form synonym map (C2) collapses known terms; cross-chunk rephrases of the same concept with different vocabulary still produce separate decision rows (5 atomic-pivot variants observed). Solve with either semantic-similarity collapse (Gemini audit P4) or cross-type supersession pass. Not urgent — decision overproduction hasn't yet blocked v12 briefing use.

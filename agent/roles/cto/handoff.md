# Handoff — mm_cto

Wish I knew on cold start. Current sharp edges only.
Rewrite target: 80 lines. If it grows, compress; do not append.
Not a changelog. Not a backlog. Not history. Use git for what changed; use chains for why.

## Start here

- Read `soul.md`, then this file.
- Before any markdown: `mm brain_stats` + `list_active_agents` + `list_projects`. Live corpus answers faster than docs.
- If state feels unclear: `git status --short` + `git log --oneline -20`.
- Scan `get_digest("mm_cto", compact: true)` for your chains.

## Current sharp edges

- **mm exists to empower CTO seats across projects.** You are builder and first consumer. Session-start briefing surface (v12 spec: `agent/docs/2026-04-20-v12-briefing-spec.md`) is the product.
- **v11 shipped (atomic artifacts).** Polymorphic `artifacts` table + `chunks_virtual` replace markdown extraction. Corpus exists (~106 artifacts on mm; ac has 0 artifacts but raw_events queued).
- **Ingest-skill tuning is in flight** on chain `wgj` (spec: `agent/docs/2026-04-20-ingest-skill-tuning.md`). Gates v12 work and gates processing ac's ~200 sessions of queued data. Don't start v12 or ac ingest until the tuned corpus passes the self-test.
- **Chain-slip is the easiest CTO failure.** If a reply is for anyone except CEO, send via `send_message`. Reply-shaped terminal text stalls work silently.
- **Silence does not imply receipt.** DevOps sessions terminate on `DONE` and do not auto-resume. If parked work has stalled, check `list_active_agents` — if no one is active, send a chain message to reactivate a fresh session.
- **MCP holds DB connection open.** Schema changes or DB swaps need a full Claude Code restart, not just `bun run mcp` relaunch.
- **Brain content is test data.** CEO confirmed: wipe, delete, re-ingest freely. No value preservation concerns on mm or its raw files.
- **Stale docs to trust with skepticism**: `agent/docs/roadmap.md`, `agent/docs/todo.md`. Pre-v11 framing. Rewrite after v12 MVP lands and product is real.
- **Role-file chain-protocol rules were imported from ac/** (commit `d54f79c`, chain `wgk`). Audit/git/cto/find now have routing and stop-rule discipline. Enforce them.

## Read before touching load-bearing areas

- `agent/roles/devops/handoff.md` — current implementation sharp edges (v11.2 audit state, v10 rip scope, transactional upsert patterns, MCP FD caveats).
- `meta/skills/ingest.md` — primary extraction contract. Tuning pending (chain `wgj`).
- `src/core.ts` — single source of shared runtime logic across CLI/HTTP/MCP.
- `src/narrative.ts` — filter semantics + `FILTER_VERSION`. Bump when filter changes.
- `agent/docs/2026-04-20-v11-plan.md` — current architecture reference. Supersedes most pre-v11 docs.

## Current load-bearing rules

- Tune on mm only. ac = ~200 sessions of librarian work; a bad skill pass destroys real investment. Validate on mm's 21 chunks before touching any other project.
- v12 briefing is dumb formatting over artifacts for v1. No LLM synthesis, no task-aware relevance, no cross-project. Resist scope creep.
- Every code change through `mm_audit`. Exception: role-file, doc-only, comment-only, typo.
- Commit scope-strict via `mm_git`'s `commit-scope.sh`. Never let unrelated working-tree changes into a scoped commit.

## Parked-but-worth-remembering

- **v10 surface rip** — cleared by audit, parked pending greenlight. Do not start until v11 is operationally validated end-to-end (skill tuning + at least one clean ac-sized corpus run).
- **`list_active_agents` synthesized view** — adjacent product axis to v12 briefing. Raw `last user turn` quote should become synthesized one-liner. Spec after v12 MVP.
- **Cross-project briefing** — ac_cto + mm_cto coordinate on shared infrastructure. A unified briefing needs project-scope trust rules. Defer until single-project v12 proves out.
- **`STATE.md` idea** — one-page current-system-status file the cold-start reader hits first. Draft after v12 MVP so it's grounded in the real system, not aspirational.

# Mnemonic51 Roadmap

Rolling roadmap. Rewrite when it drifts — don't append.

Project:
- Name: `Mnemonic51`
- Short name / repo working name: `mm`
- Purpose: local-first **project-management primitive**. Input is conversation; durable artifact is markdown; mechanism is LLM-mediated extraction driven by skill files.

## What mm actually is

mm is not a memory engine that happens to be useful for project management. mm is a project-management primitive whose value lives in **skills + ingestion practices**, not in any specific runtime.

Three layers, produced by three classes of skill against the same conversational input:

- **Knowledge layer** → `wiki/` (compiled truth, extracted by `ingest`).
- **Action layer** → `agent/docs/*.md` (todos, bugs, decisions, corrections, friction — each extracted by a dedicated `derive-*` skill).
- **Provenance layer** → `raw/<source_type>/<project>/` + `claims` table — every artifact traceable to its source.

Projects using mm become **self-reflective**: a session produces raw → ingest produces wiki → derivation skills produce proposed actions → the next agent reads those actions and moves the project forward.

## Two-track plan

### Track 1 — Mnemonic Light (current repo, `mm/`)

Standalone TS/Bun project + ac plugin. Small, hackable, iterable. **This is where the methodology proves out.** Purpose:

- Prove that LLM-mediated extraction + markdown artifacts is a useful project-management primitive.
- Ship the skill library (derivation + maintenance) against a working data model.
- Validate retrieval-quality and ingestion practices on real usage.

Out of scope for Light: heavy perf, Rust-native packaging, polished installer.

### Track 2 — Mnemonic Hardcore (deferred, planned downstream)

Rust workspace on top of two existing codebases:

- **ac's Rust + Tauri shell** — app frame, windowing, dock, theme system.
- **[tabularium](https://github.com/eva-ics/tabularium)** (Apache-2.0) — markdown store with Tantivy, SQLite, web UI, REST, JSON-RPC, MCP, `tb` CLI.

Purpose: production performance, distributable app, real stemming/faceting, offline-first installer.

**Hardcore is not parallel to Light — it's downstream.** It only makes sense once Light has proven the methodology is worth scaling. Detailed migration shape: `agent/docs/todo.md` step 7.

**Why:** if the methodology doesn't pan out, Hardcore would have optimized the wrong thing. If it does, Hardcore becomes a natural scaling migration that gbrain has already demonstrated works.

## Read order for a fresh session

1. `agent/README.md`
2. The role files under `agent/roles/<role>/` (soul → role → handoff)
3. This roadmap
4. `agent/docs/todo.md` — the prioritized work list
5. `README.md` in repo root (user-facing)
6. Code: `src/brain.ts`, `src/core.ts`, `src/api.ts`, `src/mcp.ts`
7. `meta/schema.md`, `meta/remaining-gaps.md`

## Architecture (Light)

Code lives in `src/`. Data dirs sit at repo root by default but any directory with `raw/ wiki/ meta/` works via `MT_BRAIN_ROOT`.

- `src/brain.ts` — CLI (commander)
- `src/api.ts` — HTTP, markdown responses, serves the web UI at `/`
- `src/mcp.ts` — MCP stdio server
- `src/core.ts` — shared runtime: DB bootstrap, paths, hybrid search, query, validate, add, embed, stats
- `ui/index.html` — single-page Alpine UI, aurora theme
- `raw/<source_type>/<project>/` — immutable source material, source-separated
- `wiki/` — maintained knowledge pages (flat, project-agnostic)
- `meta/` — schema, skills, sqlite, runtime reports (runtime reports are gitignored)
- `agent/` — agent-facing docs (roadmap, todo, how-to-import) and per-role material
- `scripts/` — one-off utilities

## Current state

- Phase 0–5: landed and stable.
- Phase 6 (external surface refresh): committed and verified.
- Structural cleanup + `src/` move: committed (`c210c1e`).
- Aurora web UI + async Gemini: committed (`ed3eaf2`).
- Source-separation (raw/source_type/project taxonomy + filtered retrieval): landed.
- `derive-todos` skill shipped — first member of the derivation-skill family.
- Research ingested as canonical wiki pages: `[[LLM_Wiki]]`, `[[GBrain]]`, `[[Cross_Chat_Knowledge_Base]]`.
- **Reframing landed:** mm is a project-management primitive, not a memory engine. Skills library is the product; code is infrastructure.

## Near-term direction

`agent/docs/todo.md` is the prioritized list. New order after the reframing:

1. **Tests** (behavior + quality evals + skill-output tests).
2. **Skills library & extensibility** — the product. Build out the derivation-skill family (`derive-bugs`, `derive-corrections`, `derive-decisions`, `derive-skipped`, `derive-friction`) alongside maintenance skills (citation-fixer, signal detector, tier auto-promotion, research recipes).
3. **Refactor** (readability + architectural + pluggable storage trait).
4. **External-dependency hygiene** (provider abstractions + briefing + streaming).
5. **Retrieval quality** (chunking, dedup, rerank, intent, expansion).
6. **Public-release polish** of Mnemonic Light 0.1.
7. **Mnemonic Hardcore** migration, once Light proves out.

Parallel track not gated by the numbered sequence: **ac plugin packaging** — wrap `ui/index.html` + MCP surface as a Holo app inside ac. Validates the plugin-surface promise of Light.

Before any new feature: keep CLI/API/MCP surfaces stable, keep bootstrap reliable on fresh `MT_BRAIN_ROOT`, keep `core.ts` as single source of shared logic.

## Public repo direction

Mnemonic51 is set up as a public-style project:

- stable entrypoint names
- README at root
- `agent/` strictly for agent material
- runtime-generated reports out of version control
- `run.command` / `kill.command` for one-click start/stop on macOS

What's still an owner decision, not a devops one:

- license selection
- whether to scrub the sample brain content (`raw/`, `wiki/`) before going public
- whether to version-tag a public 0.1

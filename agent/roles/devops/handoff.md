# Handoff — mm_devops

Last updated 2026-04-18 at the end of a long session that produced a major reframing. Read this in full before picking up — today's thinking is heavy.

## The reframing (most important)

**mm is not a memory engine with project management as a side effect — it is a project-management primitive** whose input is conversation, whose durable artifact is markdown, and whose mechanism is LLM-mediated extraction driven by skill files. See the top of `agent/docs/roadmap.md` and the "What mm actually is" block of `agent/docs/todo.md`.

Practical consequences, all landed in docs:

- **The skills library is the product.** Code is infrastructure. New skills are features, added without new code.
- **The derive-* family is the core capability.** `derive-todos` shipped; `derive-bugs`, `derive-corrections`, `derive-decisions`, `derive-skipped`, `derive-friction` are specced in todo.md 2b–2f.
- **Hardcore (Rust) is deferred to step 7.** Not parallel to Light — downstream. Migration only happens after methodology proves out.
- **Synthesis goes `-p` only in production.** Interactive remains a dev tool.
- **Orchestration needs a declarative layer.** `meta/config.toml` + Bun scheduler + Settings UI + `/config` API. Manual crontabs rot. Specced in todo.md under step 2 "Orchestration."

## Current commit state

- Committed through `7b5f0ef` ("Land source-separation end-to-end") and `5b5bce2` ("Update handoffs after landing source-separation").
- **Uncommitted** (this session): `agent/docs/todo.md` (major rewrite), `agent/docs/roadmap.md` (reframing), `agent/README.md` (links), `meta/skills/ingest.md` (tightened audit trail), `meta/skills/derive-todos.md` (new), `agent/docs/how-to-import.md` (minor), `agent/docs/how-to-index.md` (new), plus this handoff.

## What this session changed (outline)

- **Aurora web UI** shipped (committed earlier in the session as `ed3eaf2`).
- **Claude Code session importer** (`scripts/import-claude.ts`) shipped.
- **Source-separation** (schema v4, recursive raw indexing, filtered retrieval) shipped.
- **Research ingested into the brain's own wiki**: `[[LLM_Wiki]]`, `[[GBrain]]`, `[[Cross_Chat_Knowledge_Base]]` under `raw/research/mm/`.
- **`derive-todos` skill written** and generalized to any opinionated source (research, exit-interview, post-mortem, feedback).
- **Ingest skill tightened**: `meta/log.md` append is now a hard completion gate.
- **Todo + roadmap restructured** around the reframing. Hardcore deferred to step 7.
- **Orchestration plan drafted**: `meta/config.toml`, scheduler daemon, Settings UI, LLM-mutable schedule config via MCP.

## Known gaps (carry into next session)

- **Provenance check in `brain process`** errors when Gemini writes wiki directly without calling `bun run brain page create`. Claude-session raw entries stay stuck at `processed=0` forever. Resolution in todo.md Orchestration → "Provenance check." Option A (read Timeline citations as provenance) aligns with the reframing. Quick code change.
- **`embedBrain` only embeds wiki pages, not raw entries.** Filter-by-project retrieval is partially broken until raw-side embedding lands. Todo 5a.
- **Gemini skipped `meta/log.md` write on two ingest passes** before the skill was tightened. Watch the next pass — if it still skips, the harness (not the skill) needs to enforce it.
- **UI wiki-link rendering is slug-based**, not title-based. Cosmetic. Todo UI followups.

## First recommendation for next session

1. **Read** in order: `soul.md` → `role.md` → this handoff → `agent/docs/roadmap.md` → `agent/docs/todo.md`. That last one is long — the reframing is load-bearing.
2. **`git status` + `git diff --stat`** — expect a large uncommitted set unless the owner already committed. If uncommitted, make the commit first (scope: "Reframing: skills as product + orchestration plan + how-to-index").
3. **Dog-food the loop**: run `bun scripts/import-claude.ts --days 1 --project mm` to import today's session into `raw/claude/mm/`. Then on the next ingest pass, the next agent has all of today's thinking already in its brain.
4. **Then step 1 — tests.** Nothing past step 1 is safe to start until the test harness exists. See todo.md 1a (behavior tests), 1b (eval harness), 1c (skill-output tests).
5. **Cheap parallel wins** while tests are being written:
   - Draft the missing `derive-*` skills as pure markdown files. No code needed; each is ~60 lines following the `derive-todos` template. Ships the skill library faster.
   - Close the provenance-check gap (Option A): ~20 lines in `brain process`, unblocks the queue.
6. **Do not start** on orchestration config / Settings UI / scheduler yet. It's a big coherent piece; deserves its own session with fresh context.

## Session-length note

Don't enforce "one concern per session." Real judgment and best solutions often emerge deep into a session (200k+ tokens). The right heuristic is: **when a reframing lands, commit + update handoff + optionally stop**. A reframing is the natural session boundary, not a pre-planned scope limit.

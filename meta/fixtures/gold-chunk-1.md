---
fixture_id: gold-chunk-1
fixture_version: 1
source_chunk_id: 72
source_event_id: 116
project: mm
segment_length_bytes: 7526
notes: |
  Auditor response on the v11 atomic-pivot plan. Curated for breadth:
  exercises decision (with alternatives_rejected), bug (with severity+status),
  correction (factual shape), friction, intent, todo, and a clear skip band
  (the preliminary "I'm reading..." turns). Picked for diversity across the
  skill's artifact palette.
---
User: You are auditing a plan for Mnemonic51 (mm), a local-first tool whose primary user is an LLM  
  agent, not a human.                                                                           
                                                                                                
  Read in order:                                                                                
  1. /Users/glebnikitin/work/code/mm/human-how-it-works.md — what mm is today (v10).            
  2. /Users/glebnikitin/work/code/mm/agent/docs/2026-04-20-atomic-pivot.md — brainstorm (the    
  "why").                                                                                       
  3. /Users/glebnikitin/work/code/mm/agent/docs/2026-04-20-v11-plan.md — the plan under audit   
  (the "what/how").                                                                             
  4. /Users/glebnikitin/work/code/mm/agent/roles/devops/handoff.md — current operational
  gotchas.                                                                                      
                                               
  Global intent of the owner:                                                                   
  Session logs, project docs, and research artifacts are valuable but rot fast and are
  impossible for an LLM to read whole. The tool must be a great entry point and search surface  
  for an LLM agent starting work on a task — deliver the right slice, hide the rest.
                                                                                                
  Your job: give an independent, dissenting-where-warranted review of the v11 plan against that 
  intent. Do not rubber-stamp. Do not rewrite the plan. Produce:
                                                                                                
  1. **Verdict**: ship v11 as-is / ship with addenda / rework. One line.                        
  2. **Addenda** the plan must incorporate before execution — concrete, minimal, each with a
  one-line rationale. Flag anything that will be expensive to retrofit if skipped now.          
  3. **Risks** the plan underweights — operational, retrieval-quality, migration, or
  schema-shape.                                                                                 
  4. **Answers to the 5 "Open decisions for auditor"** at the bottom of the v11 plan.
  5. **What to cut** — anything in scope that is premature or unnecessary for the stated intent.
                                                                                                
  Be blunt. Disagree with specific claims by quoting them. Keep it under 800 words.

Assistant: I’m reading the four requested documents in order, then I’ll audit the v11 plan against the stated LLM-first retrieval intent and answer the five open decisions directly.

Assistant: I’ve got the current v10 model and data-flow. Next I’m reading the pivot note, then the actual v11 plan, and finally the ops handoff to check whether the plan ignores current failure modes.

Assistant: I have the plan. I’m reading the handoff last because that’s where hidden operational contradictions usually show up: WAL, backups, MCP expectations, and anything the plan assumes away.

Assistant: I have enough to review the plan, but I’m checking one implementation seam before I answer: the existing `chunks`/search schema, because one of the open decisions depends on whether v11 is about to create an avoidable second chunk store.

Assistant: **Verdict**

Ship with addenda. The direction is right; the cutover timing is not.

**Addenda**

- Add a compatibility read path before deletion: do not remove `wiki/mm/*.md` or `raw/events/*.md` until artifacts are actually consumed by query/briefing. Rationale: `"No briefing protocol implementation ... follows in v12"` means v11 otherwise deletes the best current LLM entry surface before the replacement exists. `Expensive later`.
- Add multi-source provenance now: `artifact_sources(artifact_id, source_event_id/source_raw_id, span_start, span_end)` instead of single `source_*` columns only. Rationale: decisions/how-tos rarely come from one chunk; retrofitting provenance after rows exist is painful. `Expensive later`.
- Make idempotency/dedup write-path behavior, not skill behavior: add explicit `artifact_key` / `idempotency_key` and per-type upsert rules in CLI/core. Rationale: `brain artifact list` round-trips in the skill are brittle and token-wasteful. `Expensive later`.
- Stop using `cp meta/brain.db ...` as backup/rollback. Use SQLite backup or `VACUUM INTO`, and checkpoint WAL first. Rationale: the handoff already warns about WAL and stale DB handles; the current snapshot plan is not operationally safe.
- Store filter version + filtered text basis for chunk offsets, or store offsets against raw plus a persisted filtered projection. Rationale: `chunks_virtual.segment_*` over raw text plus “reapply filter on read” is not stable if filtering changes length/content. `Expensive later`.
- Add a hard rule that raw event text is never destroyed, only derived views are filtered. Rationale: regex noise-stripping will hide exactly the tool/error evidence the system says it wants to capture.

**Risks Underweighted**

- `"Delete wiki/<project>/*.md files. This is the break."` is a retrieval regression, not just a storage change. Today those pages are the only condensed, curated entry point.
- `"No UI work"` and `"No briefing protocol implementation"` together mean v11 mostly changes ingestion/storage, not the LLM-facing retrieval surface the owner actually cares about.
- The plan overestimates rollback. `"Assume rollback works"` is not credible with SQLite WAL plus the documented MCP stale-FD issue.
- Free-form `artifacts.type` + opaque JSON is fine for iteration, but without normalized keys you will get duplicate rows, weak filters, and fragile later migration.
- `import-code.ts` may flood operational memory with low-signal git churn before the system proves it can summarize session chunks well.
- Lossy filtering at read/import time risks suppressing stack traces, command outputs, and failed-tool context that should become `tool_error` or `howto` artifacts.

**Answers to the 5 Open Decisions**

1. `brain export --to md`: on-demand only. Do not auto-run after every librarian pass.
2. `chunks_virtual` vs `chunks`: separate table. Existing `chunks` are search/embedding units; narrative windows are process-state spans.
3. Dedup: not in the skill. Put it in `brain artifact batch`/core with per-type matching rules.
4. Idempotency: explicit `idempotency_key`/`artifact_key`, not hash-of-JSON. Canonical JSON hashes rot as shapes evolve.
5. Old `wiki/mm/*.md`: do not rely only on git history. Archive them, and preferably keep them read-only until v12 retrieval exists.

**What to Cut**

- Cut destructive deletion from v11. Keep the old markdown surfaces as legacy/read-only for one version.
- Cut `import-code.ts` from v11 unless you first prove artifact extraction quality on session/history chunks. Repo code and git already exist as sources; this is not the bottleneck yet.
- Cut automatic supersession logic for all types except maybe `correction`. Generic contradiction detection from a single chunk is error-prone.
- Cut the claim that `"The human is an observer"` as an implementation assumption. Humans are still the recovery/debug path; the plan leans on that path while simultaneously removing their readable state.

User: txs, perfect

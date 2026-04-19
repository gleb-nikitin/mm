---
title: Future Tasks
slug: future-tasks
tags: [extracted]
type: analysis
status: active
created_at: 2026-04-20
updated_at: 2026-04-20
---

# Future Tasks

<!-- ENTRIES: append-only below this line -->
- **2026-04-20** [mm]: Todo 5a: "raw-chunk embedding" to make raw content vector-searchable and visible in filtered vector search. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Roadmap includes a two-track plan (Light vs Hardcore) with priorities defined in `agent/docs/roadmap.md`. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Brainstorm backlog in `agent/docs/todo.md` contains tiered-compute notes and philosophical direction. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Tests: Implement behavior-level integration tests for CLI/HTTP/MCP using `bun test`; create a retrieval-quality eval harness. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Skills library: Implement `derive-*` skills (bugs, corrections, decisions, skipped, friction) and maintenance skills (citation-fixer, signal detector, auto-promotion). Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Observer Mode: Implement background file-watching to trigger index rebuild automatically on file changes. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Technical Requirement for Observer Mode: Use a persistent file watcher (e.g., `chokidar` in TS or `notify` in Rust) to monitor `raw/` and `wiki/` directories. On change, trigger `internalRebuildIndex` to keep SQLite in sync with disk without manual operator intervention. This is a prerequisite for a zero-friction Librarian experience. Source: `Librarian Feedback`
- **2026-04-20** [mm]: Refactor: Readability pass on `src/brain.ts`; move logic to `src/core.ts`; implement pluggable storage trait for future Rust migration. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Provider abstractions and streaming: Abstract Ollama/Gemini; implement streaming for `/query` and briefing-based synthesis. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Retrieval quality: Smarter chunking (wiki and raw), reranking, BM25 weighting, and intent classification. Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Mnemonic Hardcore: Rust migration (deferred until Light methodology is proven). Source: `raw/docs/mm/todo.md`
- **2026-04-20** [mm]: Legacy Refactor: Update `scripts/import-chats.ts` to use `addToBrain` and follow the current `source_type`/`project` taxonomy. Source: `raw/docs/mm/how-to-import.md`

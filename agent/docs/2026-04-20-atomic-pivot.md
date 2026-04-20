# Plan: The Atomic Pivot (2026-04-20)

**Source**: Discussion between User and Librarian (2026-04-20).
**Status**: Approved / Ready for Execution.
**Objective**: Transition Mnemonic51 from a "Knowledge Repository" (monolithic files) to a "Knowledge Operating System" (Atomic DB-first architecture).

---

## 1. Raw User Intents (The "Why")

1. **Virtual FS**: Move away from physical `.md` files for high-volume data. The DB is the source of truth; humans use a tool/UI to view the DB *as if* it were a file system.
2. **Atomic Granularity**: TODOs, Intents, and Decisions must be individual DB rows, not lines in a giant file. This allows for atomic updates, tagging, and status management without file-write overhead.
3. **Semantic Summaries**: Every narrative chunk read by the Librarian must produce a summary + tags in a metadata layer. This allows a "Time Machine" search: see the summary first, click to deep-dive into the raw 12KB context.
4. **Specific Artifact Streams**: Capture Stack Decisions (rationale/rejected paths), How-To recipes (hard problems solved), and Tool Errors (identifying silent agent failures).
5. **Durable compass**: Maintain an "Intents" page to track the project's North Star and detect "Project Drift."

---

## 2. Architectural Standards (The "What")

- **Hot Source**: SQLite (`raw_events`, `artifacts`, `summaries`).
- **Cold Source**: `wiki/` (still Markdown for Git-backed stability and external editing).
- **Virtual Chunks**: Narrative windows (10-12KB) are served directly from the DB to the Librarian's memory. No intermediary `.md` event files on disk.
- **Deterministic Filtering**: Strip mechanical noise (tool outputs/logs) via regex at the import/read stage.

---

## 3. Implementation Roadmap

### Phase 1: Schema Migration
- Implement granular tables: `intents`, `todos`, `decisions`, `stack_decisions`, `howto_recipes`, `event_summaries`, and `tool_errors`.
- Add `chain_id` and `intent_id` to `raw_events` for narrative reconstruction.

### Phase 2: The Virtual Narrative Tooling
- Deprecate `scripts/chunk-events.ts`.
- Build `src/narrative.ts`: A tool to fetch turn-aligned, signal-filtered windows of history directly from SQLite.
- Implement the "View-as-File" UI/CLI for humans to read DB rows as a unified narrative.

### Phase 3: The "Granular Librarian"
- Update `meta/skills/ingest.md` to output **JSON Rows** instead of Markdown appends.
- The Librarian now "calls" `db_insert_artifact` (decision/todo/howto) instead of updating monolithic wiki pages.

### Phase 4: Intent Calibration & Tiered Search
- Implement a "Compass" check: Every synthesis pass compares the session against the `intents` table.
- Update `hybridSearch` to prioritize **Wiki > Recent Events > Archived History**.

---

## 4. Key Artifact Streams to Capture

| Artifact | Mandatory Fields |
|----------|------------------|
| **Intent** | Statement, Alignment Score, Status (Active/Retired). |
| **Decision** | The Decision, Rationale, **Rejected Alternatives**, Source ID. |
| **Stack** | Technology, Why this vs others, Source ID. |
| **How-To** | Problem, Successful Solution steps, Source ID. |
| **Tool Error** | Tool called, Error message, Agent reasoning at the time. |

---

*This plan officially retires the "Karpathy/GBrain" monolithic file model for streaming events in favor of an Atomic Knowledge Operating System.*

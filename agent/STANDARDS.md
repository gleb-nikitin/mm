# Mnemonic51 Agent Standards: Zero-Waste Execution

These standards apply to ALL agent roles (Lib, DevOps, Git, etc.) working on this project. They are derived from the first successful Librarian shift (2026-04-20).

## 1. Zero-Waste Reading & Analysis
- **Mandatory Filtering**: Explicitly ignore tool execution logs that confirm success without providing architectural signal (e.g., `npm install` success, 500 lines of unchanged file `cat`).
- **Focus on Deltas**: When reading logs or code, prioritize the changes (deltas) and the reasoning behind them over the final state.
- **Signal-to-Noise Sweet Spot**: Aim for **10KB–12KB** of narrative context per pass. This provides enough depth for synthesis while minimizing "Preamble Tax" and token noise.

## 2. Rigorous Provenance
- **Never state a fact without a trail.** Every claim made in a wiki, todo, or roadmap must cite its source:
  - `raw/path/to/file.md` for documents.
  - `event:<id>` for session chunks or DB entries.
  - `[[Slug|Title]]` for existing wiki pages.
- **Rejected Paths**: Record not just the final decision, but the 2–3 alternatives that were tried and failed. This is as valuable as the success.

## 3. Active Investigation vs. Passive Filtering
- **Intent vs. Outcome**: Explicitly check if the outcome of a session matched the original user intent. Document any "Project Drift."
- **Narrative Grafting**: Do not just append new information. "Graft" it into the existing project narrative by explaining what previous assumption this new data overwrites.

## 4. Lifecycle & Durability
- **Compile the Truth**: Every session should produce or update a durable artifact (Wiki, Todo, Roadmap). 
- **Context Compression**: When a thread or task is resolved, summarize the constituent `raw_events` into a single wiki entry and recommend archiving the constituent events to clear future search context.

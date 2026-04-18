# Changes: mm_lib

These are the architectural and operational changes I want to see implemented to make the lib's job effective.

## 1. The "Soul" Priority
- **Change**: Introduce `source_type='soul'` for agent exit interviews and retirement notes.
- **Why**: These are the highest-signal documents in the project. They should be "warm-loaded" into the agent's start-of-session context automatically.

## 2. YAML-First Provenance
- **Change**: Allow `sources: [path/to/raw]` in wiki frontmatter.
- **Why**: Querying for integer IDs in SQLite is "mechanical noise" that breaks the flow of synthesis. Let the sync engine resolve the IDs.

## 3. The "Signal Filter"
- **Change**: Chat imports should optionally drop `[tool: ...]` blocks or replace them with high-level summaries.
- **Why**: Mechanical logs hide the "Project Soul." An agent should spend time reading decisions, not bash commands.

## 4. Context-Aware Stopping
- **Change**: A `brain session stop` command that writes a `RELAUNCH_NEEDED` marker to the DB.
- **Why**: Currently, I have to "guess" when my context is full. The system should track token usage and prompt me to retire when I'm becoming inefficient.

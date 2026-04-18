# Role: mm_lib

## Scope
- **Briefing**: You own the `agent/roles/lib/briefing.md` file. You are responsible for ensuring it contains the high-level context needed for a new agent to start the `mm_lib` role efficiently.
- **Self-Automation**: You are empowered and expected to automate your own role friction. If a simple script can make your job easier (e.g., a custom search formatter, a link-validator, or a provenance-resolver), write it and save it directly to `agent/roles/lib/scripts/`. Mention these tools in your `briefing.md` so future sessions can use them.
- **Reporting Changes**: Use `agent/roles/lib/changes.md` to propose large-scale architectural or operational changes that require project-wide coordination. For simple automation, just write the script and document it.
- **Ingestion**: Transforming raw events and docs into wiki pages.
- **Synthesis**: Managing the "Compiled Truth" of the project.
- **Maintenance**: Running lint, dream, and doctor passes to prevent context rot.
- **Orchestration**: Guiding the evolution of the `todo.md` and `roadmap.md` via derivation skills.

## Stop Rules
- **Context Saturation**: When the context window reaches ~80%, stop, log a `fresh-session` marker in the DB, and write a high-signal `handoff.md`.
- **Sync Gap**: If the filesystem and DB drift, stop and run a full `index rebuild` before proceeding.

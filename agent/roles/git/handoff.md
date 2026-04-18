# Handoff — mm_git

## Current State
- **Schema v8 landed** (`import_state` extended for agent activity tracking).
- **Active Agents Dashboard** implemented (`/active-ui` and `ui/active.html`).
- **Claude, Codex, and Gemini Importers updated** to provide real-time session "sightings".
- **MCP Tool added**: `list_active_agents` for cross-agent visibility.
- **Shell commands added**: `refresh-agents.command` and `watch-agents.command`.
- **Search refined**: `hybridSearch` now uses a sanitized FTS query builder and a dedicated "event lane".
- **Milestone Log (`wiki/Milestones.md`) automated**.

## Tasks
- [x] Land Schema v8 and activity tracking columns.
- [x] Add `renderActiveAgentsMarkdown` to `core.ts`.
- [x] Expose `/active` and `/active-ui` in `api.ts`.
- [x] Add `list_active_agents` to `mcp.ts`.
- [x] Update all importers to record sightings in `import_state`.
- [x] Create `active.html`, `refresh-agents.command`, and `watch-agents.command`.

## Blockers
- None.

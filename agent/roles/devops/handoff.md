# Handoff — mm_devops

Last updated 2026-04-18 after landing Agent Activity tracking.

## Current state

- **Schema v8 live** (extends `import_state` for real-time agent sightings).
- **Active Agents Dashboard** live at `http://localhost:3000/active-ui`.
- **Importers (Claude, Codex, Gemini)** now update the activity dashboard on every run.
- **MCP `list_active_agents`** available for tool-based monitoring.

## What this session changed

- **Database**: Extended `import_state` with `provider`, `external_id`, `project`, `cwd`, `model`, `last_user_snippet`, and `min_turns_ok`.
- **Core**: Added `renderActiveAgentsMarkdown` for data synthesis.
- **API**: Added `/active` (MD) and `/active-ui` (HTML) endpoints.
- **MCP**: Added `list_active_agents` tool (v0.8.0).
- **Importers**: Updated `scripts/import-*.ts` to update `import_state` even if sessions aren't yet settled or meeting turn quotas (capturing "sightings").
- **UI**: Added `ui/active.html` (Alpine.js dashboard).
- **Commands**: Added `refresh-agents.command` and `watch-agents.command` for macOS desktop integration.

## Verification this session (all green)

- `bun run typecheck` green.
- `initDb()` migrates to v8 correctly.
- Dashboard verified to show live Claude/Gemini sessions with correct time-ago and user snippets.

## Next steps

1. Follow `agent/docs/todo.md` step 1 — **tests**.
2. Once tests provide a safety net, proceed to step 2 (readability pass on `src/brain.ts`).

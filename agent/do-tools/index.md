# Aurora MCP / `do` Tool Catalog

Canonical `do` documentation lives in the **ac repo**, under `agent/do-tools/`
(checkouts are expected to be siblings, so `../ac/agent/do-tools/` from this
repo's root):

- `index.md`
- `chain.md`
- `code.md`
- `task.md`
- `cto.md`
- `clean.md`
- `drive-ui.md`
- `other.md`

Use those docs as the source of truth. The same command families apply here:
chain ops, code search, tasks, orientation/forensics, cleanup/triage, UI
smoke tools, and shared utilities.

mm-specific notes:

- Use native `send_message` for chain replies; do not fake chain messages in
  terminal text.
- Start with `do feed` when the registry is available.
- Prefer read-only `do` calls unless a dispatch explicitly asks for cleanup or
  state mutation.
- If `do` returns `unknown_command` with an empty known-command list, the
  runtime registry is not wired for this repo/session. Use native tools that
  are available and report the gap in-chain if it blocks work.

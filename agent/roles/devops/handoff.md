# Devops Handoff

Current state:
- `yjn-45` landed locally at `353e583 chore(deps): move type tooling to dev dependencies` after audit PASS `yjn-47`.
- No active devops implementation task remains.

Dependency contract:
- `typescript`, `@types/node`, and `bun-types` are devDependencies only.
- Production dependencies remain `@modelcontextprotocol/sdk`, `commander`, `js-yaml`, and `smol-toml`; each has a runtime import in ac's shipped allow-list.

Production-stage evidence:
- Staged exactly `src/`, `scripts/`, `meta/skills/`, `meta/schema.md`, `pricing.toml`, and `package.json`.
- Before: 56,120 KiB production `node_modules`; after: 26,228 KiB.
- Saving: 29,892 KiB (~29.2 MiB); moved packages were absent from the changed production install.
- API served `/stats` and `/api/v1/tokens/active`; all importers completed; watcher emitted a full tick; MCP answered initialize over stdio.

Repository gates:
- `bun test`: 137 pass, 0 fail, 680 expectations.
- `bun run typecheck` (`tsc --noEmit`): passed.
- `bun install --frozen-lockfile --dry-run`: passed.
- `git diff --check`: passed.

Working tree:
- `agent/roles/cto/wish-i-knew.md` is unrelated CTO-owned work.
- This handoff rewrite is role-owned post-commit state.

Next checks:
- In ac's next bundle, confirm the packaged production tree reflects the ~29 MiB reduction and still starts both managed processes.

# State — mm_cto

What next CTO needs on cold start. Current sharp edges only.
Not a changelog. Not history. Use git for what changed; use chains for why.

## Start here

- Read `soul.md`, then this file.
- `do feed` (or chain digest) — see what's waiting.
- `git status --short` + `git log --oneline -15` if anything feels off.

## In-flight on relaunch

- Nothing active. Last motion (notes UI/API + migration) shipped at `a7cb5c8` via chain `yfj`.
- **mm drain complete**: 99/99 chunks processed → 94 notes, 205 unique titles. `distill-new.command` shipped and validated. ac/ corpus is CEO-direct decision.

## Recently shipped

- mm now runs as Aurora plugin (Phase 8). `bun src/api.ts` binds `AURORA_PLUGIN_SOCKET` when set; `scripts/watch.ts` is the supervisor-managed importer loop. `processes.toml` at repo root declares both. Standalone mode still works via `run.command`.
- UI base-path-aware: `BASE_PATH = '/plugin/mm'` under sc2, `''` standalone (`12391fc`).
- Public push: https://github.com/gleb-nikitin/mm (`ae35bf0` scrubbed user paths + gitignored raw subdirs).
- Distill notes schema v15 (`5ddbcd6`): `notes`, `note_title_hashes`, `notes_fts`, `brain note add` CLI, embedding integration, canonical `meta/skills/distill.md`.
- Notes UI/API (`a7cb5c8`): `/notes`, `/note/:id`, `/notes-search`, `/notes-ui`, self-healing FK migration. Audit PASS at `yfj-6`.

## Sharp edges

- **Aurora supervisor stomps symlinks on seed-reconcile.** mm code lives at `~/adev/jo/plugins/mm` as a symlink to the mm checkout. If Aurora rebuild fires seed-restore, the symlink gets replaced with a stub directory. Recovery: kill orphan bun PIDs, `rm -rf` the directory, recreate symlink, touch top-level `processes.toml`. Reported to ac at `xsu-14`.
- **Supervisor leaks orphan child processes** on respawn. Multiple `bun src/api.ts` PIDs accumulate. Killing them manually is the recovery; same flag at `xsu-14`.
- **`/api/v1/tokens/active` returns multi-row per participant** after valhalla extension. Consumers must filter `state ∈ {working, idle}` or match `participants.active_session_id`. ac was warned at `xkd-4`; mm UI sort fixed at `b7ad412`.
- **Brain has live content** (94 notes from full mm drain). Wipe only if intentional. `bun scripts/reset-brain.ts --full`. Always stop the API first.
- **Chain-slip = silent failure.** If a reply addresses anyone other than CEO/terminal-watcher, use `send_message`. Reply-shaped terminal text doesn't deliver.

## Cross-project — open

- **`xkd-4`** to ac_cto: relaunch consumer reads wrong rows from `/tokens/active`. ac's fix status unknown.
- **`xpj-2`** parked: per-turn telemetry (charts) — CEO explicitly does not want now.
- **`xjv-1`** older: retire ac local Claude scanner in favor of `/api/v1/tokens/active`. ac never engaged.

## Known data gaps (parked, not blocking)

- `session_events` and `session_message_links` tables empty.
- `pricing.toml`: `claude-haiku-4-5-20251001` may still be missing.
- ~85 codex sessions in `cwd=ac/` are unresolvable (ac never registered as participants).

## Load-bearing rules

- Every code change through `mm_audit`. Exception: role files, docs, comments, typos, shell-only.
- Audit PASS → implementer forwards to mm_git with commit-scope.
- Push and PR are CEO-only.
- Live corpus before markdown.
- Don't reply to `mm_git` COMMITTED notices.

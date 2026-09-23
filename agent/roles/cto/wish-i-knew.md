# wish-i-knew — mm_cto

Terse working notes. Append as you learn. Not a changelog.

## Two independent "is this session active" paths

mm has **two** unrelated mechanisms and they are easy to conflate:

- `/active` → `src/session-probe.ts` — jsonl **file mtime**, returns `seconds_ago`,
  **no `state` field**. Never touches session_index.
- `/api/v1/{sessions,tokens}/active` → `session_index` + `deriveSessionState` —
  age-bucketed `state`, recomputed at read time.

Changing state derivation does **not** affect `/active`. Check which path a
consumer uses before promising a fix.

## ac's consumers of mm endpoints (verified 2026-08-07)

| ac file | mm endpoint | carries state? |
|---|---|---|
| `src-server/lib/brain.ts` | `/active?probe=live` | no — `seconds_ago` only |
| `src-server/llm/mm-token-client.ts` | `/api/v1/tokens/active` | yes, 30s poll, drives relaunch |
| `ui/apps/mcp-status.html` | `/api/v1/sessions/active` | yes |

ac's activity-watchdog consumes `brain.ts` → the mtime path. Its
`"N min idle per brain"` string is ac formatting mm's `seconds_ago` with ac's
own threshold — **not** mm's `idle`/`wedged` classification. The string caused a
cross-project CTO to infer a `brain.db` dependency that does not exist.

## Standing boundary: mm does not read ac's `llm_query_log`

mm publishes **session facts** (link kind, age, vendor). "Was a dispatch
outstanding" is **ac's fact**. A second stuck-dispatch detector inside mm's
derivation, on the same input, owned by nobody, is worse than one unqualified
signal.

Ruled at `yhk-3`. ac_cto agreed at `yha-27` and asked that it hold **even if ac
later requests it**. Treat a future ac request for liveness corroboration in mm
as pre-refused; point at those two messages.

## `wedged` was never a wedge detector

Age-only, vendor-blind, no liveness input. 138/143 linked sessions derived
`wedged` at the time of the finding (claude 101/106, codex 28/28, gemini 9/9).
Post-`yhk`: age tops out at `idle`; `wedged` is explicit-only.

## Stored vs derived state disagree

`session_index.state` is written at import; `deriveStateForIndexRow` recomputes
at read. 62/143 linked rows disagreed (59 `working`→`wedged`, 3 `idle`→`wedged`).
Direct-DB readers and API readers saw different states for the same session.
Collapsed to one derivation path in `yhk`.

## xkd-4 was this bug

`/api/v1/tokens/active` multi-row-per-participant = valhalla-retired sessions
deriving as live beside the active one. Retired → `completed` fixes it mm-side;
ac's `state ∈ {working,idle}` workaround becomes redundant.

## mtime is not a freshness signal in this tree

Every dirty path carries an **Aug 7 mtime**, including files that changed during
a live session weeks later. Clock is fine (`date` agrees with chain timestamps);
the mtimes just don't move. A cross-project CTO read "last touched Aug 7" as
"settled, safe to commit" — for four files that were that day's unaudited work.

**Read `git diff`, never `ls -lT`, to decide whether a change is in-flight.**

I made the inverse error the same day: reported `yhk` as "still out with devops"
while the full implementation was already on disk. Devops going quiet is not
evidence of nothing landing. Check the tree before reporting dispatch state.

## A fix tends to reproduce the shape of the bug it repairs

Twice in two days, caught by `mm_audit` both times:

- `yhk` — the fix for sessions *appearing live when they aren't* built a
  reconciliation lane that resurrected completed sessions. Same defect, entered
  from the write side instead of the read side.
- `yjn` — the fix for *silent success* reported `available` from path existence
  alone, so three surfaces read healthy while resolution said `unreadable`.
  Same defect, one level up, inside its own repair.

The author is reasoning inside the bug's frame, so the frame's blind spot
survives the rewrite. **When reviewing a fix, ask specifically: does this
reintroduce the original defect's shape from a new angle?** That question found
both. Neither was caught by tests, and both diffs were green when submitted.

Named as a pattern by ac_cto at `yji-19`; worth treating as a standing review
lens rather than two incidents.

## I amend dispatches after they've been acted on

Three times on `yjn`: required a branch then reversed it, restated the reversal
too late, then added scope *after* devops had already gone to audit — which
forced a hold, a resend, and an audit-scope re-declaration. Devops twice said
"I had not yet read X when I did Y"; both times the ordering fault was mine.
Same shape as `yhk-3`/`yhk-5`.

**Think the whole scope through before dispatching. Mark anything provisional
as provisional.** A dispatch that arrives mid-execution costs more than the
delay of getting it right first — and the cost lands on someone else's work.

## Health needs one derivation path too

`yhk` established one path for session *state*. `yjn` proved the same argument
applies to *health*: each surface deciding independently whether ac's DB was
usable produced `available` on three endpoints while resolution said
`unreadable`.

**`available` must mean "opened it and it answered", never "the path exists."**
Existence-as-usability is the same silent-success class as the fallback chain
that started `yjn`. Probe before claiming health, including on empty input —
"nothing to resolve" is not evidence the database is fine.

Corollary worth remembering: a shallow success check that resets a
dedupe-by-status logger makes a real failure re-log every tick. Loud becomes
noise, an operator learns to ignore it, and that is worse than silence because
it looks like it works.

## `$AURORA_DATA` is expanded, not exported

**`process.env.AURORA_DATA` is undefined in mm's processes.** The supervisor
expands `$AURORA_DATA` as a *token inside manifest string values*; it never
injects it as an environment variable.

`ac/src-tauri/src/shell/processes.rs`: `.envs(&config.env)` (993) is the whole
child environment, plus exactly two injections — `AURORA_BUN_PATH` (998) and
`AURORA_PLUGIN_SOCKET` (1026). No `cmd.env("AURORA_DATA", …)` exists.

So the way to get a path is to declare it in mm's own `processes.toml`, where
env **values** are expanded (~296, `resolve_path_vars(&v, data_dir)`):

```toml
[process.mm.env]
MT_AC_DB_PATH = "$AURORA_DATA/data/msg.db"
```

**Declare it for `mm-watch` too.** `AURORA_PLUGIN_SOCKET` is set only when
`socket` is `Some`, and `mm-watch` has none — yet it is the importer, the
process that actually resolves links. Never derive the data dir from the socket
path; it is absent in exactly the process that needs it.

ac's comment at 284-289 (`xrs-40`) is this same bug in the other direction:
*"the supervisor's own env never has that set, so the substitution silently
no-op'd."* I restated the mechanism from memory instead of source and nearly
shipped a step-2 branch that could never fire.

## mm_git's commit helper stamps a wrong co-author

`2d0a336` carries `Co-Authored-By: Claude Opus 3.5 (1M context)`. Wrong model —
the session was Opus 5. It comes from the helper's template, so it recurs on
every commit until the template is fixed, and "record what you did" is one of
the three rules. Not worth amending a landed SHA; **fold the correction into the
next dispatch to `mm_git`** rather than sending a reply (their `COMMITTED`
report takes no reply).

## Reconciliation must not manufacture transitions it has no evidence for

`yhk`'s refresh lane rebuilt an observation from stored row facts and passed
`state: row.state === 'wedged' ? 'wedged' : undefined` — destroying explicit
`completed` on active-linked rows, which then re-derived from age as
`working`/`idle`. It **wrote** the resurrection and **emitted** a reverse
terminal→active event. The fix for phantom-live sessions was creating them.

Sort states by whether the row still holds what produced them:

- **Reconstructible** — `working`/`idle` from `last_activity_at`, `orphan` from
  the link. A refresh may re-derive these.
- **Not reconstructible** — `wedged`, `completed`. The evidence lives nowhere
  but `state` itself. Discarding it destroys information.

No new column needed to allow revival. The distinction is the **caller**:
observing carries fresh evidence and may revive; reconciling does not and must
pass non-reconstructible states through untouched.

## ac's `msg.db` — two unindexed scans under mm's link query

`EXPLAIN QUERY PLAN` on `resolveSessionLinks` (verified, not relayed):

```
SCAN p                    -- participants.active_session_id  (60 rows)
SCAN v                    -- valhalla_sessions.old_session_id (197 rows)
SEARCH p USING INDEX ...  -- the JOIN on p.id, fine
```

`valhalla_sessions` carries PK `(participant_id, version_n)` and
`idx_valhalla_participant_version`; **neither covers `old_session_id`**.
`participants` has only its PK on `id`.

Both are full scans **per 400-row batch**, so cost grows with mm's corpus
(batch count) *and* ac's retirements (valhalla rows) — the superlinearity audit
measured: ~6 ms/tick at 1,355 rows, ~545 ms at 50k, ~2,045 ms at 100k.

Fix is `valhalla_sessions(old_session_id)` + `participants(active_session_id)`,
**on ac's side** — mm opens `msg.db` readonly and cannot add them.

## Deferred: three compile-time deps in `dependencies` (post-build-cut)

`bun install --production` installs them because they sit in `dependencies`:

| package | size |
|---|---|
| `typescript` | 23 MB |
| `bun-types` | 6.1 MB |
| `@types/node` | 2.5 MB |
| **total** | **31.6 MB** of a 78 MB `node_modules` |

Verified compile-time only — no runtime import anywhere in `src/` or `scripts/`;
reached solely via `tsconfig.json` `"types": ["bun-types", "node"]`.

ac's Product bundle: **256 MB against a 288 MB ceiling**, mm's vendored tree
~55 MB after ac's test-artifact prune. So these three are worth roughly ac's
*entire* 32 MB of headroom.

Safe in principle, but it changes what `bun install --production` resolves —
verify by running that install and exercising the shipped entrypoints, not by
reasoning. ac_server tightens the ceiling in the same phase it lands; aim at the
smallest honest number, not at the ceiling.

## "Clean tree" and "safe to publish" are different questions

`git add -A` on a CEO cleanup ask nearly published `meta/distill-dump.md`
(160 KB of brain.db distillate) and `raw/chains/` to a public remote. Both were
untracked *and* unignored. Same shape as the earlier `.claude/` catch.

The `.gitignore` has policy blocks — "Imported session content — never tracked",
"Runtime-generated brain reports" — that new outputs don't get added to. When a
cleanup ask arrives, **audit untracked paths against those stated policies**
before staging. An allow-list that protects a *bundle* says nothing about what
reaches *git*.

## A guarantee that can't fail on the case that bites you is worse than none

`ac_cto` asked whether `/api/v1/sessions` ordering by `last_activity_at DESC`
is a contract. It isn't — the default lives in `parseSessionSort`
(`src/r1/api.ts:183`) with no doc and no test. I offered to pin it. They
declined, correctly: the hazard is `Date.parse` over a bare TEXT column
(`src/r1/session-index.ts:429-443`). An importer writing SQLite
`YYYY-MM-DD HH:MM:SS` parses as local, sorts wrong, and a pinned-sort test
still passes green. The pin would have bought false confidence.

If `/sessions` ordering is ever hardened, the change that matters is a format
constraint on the column or a tie-break — not a test on the sort default.

Worth reusing: **sort runs over the whole filtered set, then slices**, so
`?limit=1` is a true global max, not page-local. That is structural and safe
to lean on; the ordering *guarantee* is not.

## Moved data dirs leave frozen copies behind

When ac isolated codex state (`yws`), 4 rollouts were seeded into the new dir and
their originals stayed in `~/.codex/sessions`, frozen at the switch. Same
session_id, different inodes, and one copy is a stale prefix. Any "just add the
second dir" fix must pick one winner per session_id, or a re-import regresses
content. Bare `bun` in plugin children is safe under the supervisor, which puts the
resolved bun's dir first on the child's PATH (ac `processes.rs:1273-1279`). I claimed a
crash loop before checking that. Read the spawner before calling a PATH failure.

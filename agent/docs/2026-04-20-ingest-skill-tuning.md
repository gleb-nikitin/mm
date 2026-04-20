# Spec: Ingest-skill tuning pass (2026-04-20)

**Source:** CTO validation read of the post-v11 artifact corpus (106 artifacts across ac/mm/newproj, first real librarian run).
**Owner:** devops.
**Status:** spec only. No code written yet.
**Scope:** one tuning pass on `meta/skills/ingest.md` + `src/narrative.ts` (+ narrow `src/core.ts` support if needed). No new artifact types. No new CLI surfaces. No pipeline shape change.
**Gate:** this pass ships before the `derive-*` skill family starts. If this doesn't tighten the corpus, the next move is structural (cross-type supersession), not more skill writing.

---

## Problem

Post-v11 first-run corpus validates the shape but shows four concrete failure modes.

### 1. Type-boundary leak

72 decisions from 21 chunks (≈3.4/chunk). Several are intents or future_ideas framed as decisions. Examples pulled live:

- `#93` decision "Establish the v11 atomic architecture as the required foundation for scaling" — vision statement, belongs in `intent`.
- `#82` decision "Implement the v11 artifacts schema with a polymorphic table" — that's a plan / todo, not a decision weighed against alternatives.
- `#104` decision "Mandate Agent-Initiated Synthesis for the Librarian" — future capability, belongs in `future_idea`.

Current skill's signal-calibration section is too permissive: "Agent proposes an approach and user agrees — that's a decision" over-fires on brainstorming chunks where the "agreement" is rhetorical ("yes, that's interesting").

### 2. Dedup failure across rephrases

Core-side dedup is by `(project, type, idempotency_key)`. The librarian computes keys from the statement slug, so rephrases get different keys and land as separate rows. Live examples:

- Three `intent` rows for the same idea:
  - `#10` "Transition mm from a knowledge store to a Knowledge OS with drift detection"
  - `#76` "Transform Mnemonic51 into a dynamic Knowledge Operating System"
  - `#39` "Merge action and knowledge layers into a single durable knowledge store"
- Two `future_idea` rows for Observer Mode:
  - `#51` "Implement an 'Observer' mode for automated file-watching and background indexing"
  - `#58` "Implement Observer Mode for automated, background file-watching and re-indexing"

This is the failure mode v11's plan flagged ("canonical-JSON hashes rot"). The fix wasn't "librarian picks stable keys" — it was that, plus a canonicalization rule the current skill doesn't state.

### 3. Under-extraction of actionable items

1 `todo` total from 21 chunks. Concrete actionable items got classified as decisions. Zero `correction`, `tool_error`, `howto`, `code_doc`, `user_note`. Some of these can be legitimately zero, but given the corpus covers the v11 migration itself, the absence of `correction` and `tool_error` is suspicious.

### 4. No chain-message awareness (incoming)

Going forward, session logs will contain chain messages whose sender is a participant (`ac_ceo`, `mm_cto`, `mm_devops`, …) not the literal "User:" role. The footer shape is:

```
---
chain: <id>
from: <participant>
to: <participant>
```

Today's `filterMechanical` (`src/narrative.ts`) doesn't parse this. The ingest skill treats everything non-Assistant as "user." Attribution is about to get wrong — a decision made by `mm_cto` inside a chain gets extracted as if the owner decided it, and a proposal by `mm_devops` to the owner gets read as a decision the moment the owner says "ok."

This is the root cause of the decision over-firing about to get worse, not better, once chains are live.

---

## Changes

### A. Chain-footer awareness in `filterMechanical`

File: `src/narrative.ts`.

Bump `FILTER_VERSION` to 2. Recognize the chain footer block at end of a message:

```
---
chain: <id>
from: <participant-id>
to: <participant-id>
```

When present:
- Preserve the footer in filter output (don't strip as noise).
- Emit a synthetic marker line ahead of the message content: `[chain-msg from=<participant> to=<participant>]`. Put it where the role marker would be. This gives the ingest skill a stable parse target without requiring it to understand footers.

A message without a footer keeps today's behavior (treated as session turn). A message with `from: <human-id>` (e.g. `ac_ceo` — owner) vs an agent participant is distinguishable downstream.

Chunk offsets stay in raw content; the synthetic marker is a read-side projection. Safe under the existing filter-version contract (A5).

**Verification:** unit test — given a chunk containing one chain message with footer, `filterMechanical` emits `[chain-msg from=… to=…]` and preserves the message body; given no footer, output matches v1.

### B. Type-boundary tightening in `meta/skills/ingest.md`

Rewrite the "Signal calibration" section around three explicit tests the librarian applies per candidate.

**Decision test (stricter than today):** a candidate is a `decision` only if **all** hold:
1. A choice between ≥2 concrete options is visible in the chunk (even if one is "do nothing").
2. One option is selected and the others explicitly dropped.
3. The rationale names a tradeoff, not just restates the chosen option.

If only (1) and (2) hold with no rationale → still `decision`, but `alternatives_rejected` carries the dropped options. If (1) fails (no alternatives visible) → candidate is `intent` or `future_idea`, not `decision`.

**Intent test:** long-horizon direction or vision. No concrete actions attached. `horizon: project` is the common case; `milestone` and `session` are rare and need a clear scope marker in the chunk ("this sprint", "this session").

**Future_idea test:** concrete capability that *might* be built, not currently planned. Distinct from `todo` (planned) and `intent` (direction).

**Todo test:** a specific action with a clear end state ("implement X", "rip Y", "rewrite Z"). If the statement reads "we should do X" and X is a concrete action, it's a `todo`, not a `decision` that X should happen.

Add an explicit **re-classification rule:** if after first-pass extraction the chunk has >2 decisions, re-read every decision against the decision test. Demote failures to intent / future_idea / todo before emitting.

### C. Canonical-form idempotency keys

In `meta/skills/ingest.md`, replace the current key rule with:

1. Normalize the core field (statement / symptom / pattern) before slugging:
   - Lowercase.
   - Strip stopwords and product-specific prefixes ("implement", "adopt", "transform mnemonic51 into", "mm").
   - Collapse synonym pairs to a canonical term using a small fixed map the skill carries (starter list in the appendix below). Example: `knowledge operating system` ≡ `knowledge os`; `file-watching` ≡ `observer mode`.
2. Slug the normalized string. That slug is the key suffix.

Keep the prefix shape `<type>:<project>:<slug>`.

This collapses the three Knowledge-OS intents and the two Observer-Mode future_ideas on the next run without requiring a cross-row supersession pass.

**Canonical-term starter map** (devops: extend during implementation from the live corpus):
- `knowledge operating system | knowledge os | knowledge-os` → `knowledge-os`
- `observer mode | file-watching | file watcher | automated file watching` → `observer-mode`
- `atomic artifacts | atomic extraction | atomic pivot` → `atomic-pivot`

The map lives in `meta/skills/ingest.md` as data the librarian consults. Not hardcoded in TS.

### D. Speaker attribution (optional field, non-breaking)

Extend the per-type `data` shape in the skill doc to allow an optional `decided_by: <participant-id>` on `decision` / `stack_decision` / `todo` / `intent`. Populated when the originating chunk contains a `[chain-msg from=…]` marker. Absent means session transcript (no chain footer seen) — retain today's implicit "user" semantics.

No schema change needed — `data` is JSON-opaque. Forward-compatible with v12 briefing weighting (owner decisions get higher briefing priority than agent-proposed ones).

### E. Known-Artifacts injection format

Out of scope for this pass if it works. But flag for monitoring:

`process-new.command` injects the "Known Artifacts" block into the librarian's session prompt. With canonical-form keys (C), the block's keys become the primary dedup signal and will be much more effective. No format change yet — verify the block is actually parseable by Gemini / the current synth provider as-is before touching it.

---

## Out of scope

- Cross-type supersession (decision → intent demotion on re-read). Only considered if A–D don't tighten the corpus.
- Implicit contradiction detection across the artifact table. Stays off.
- New artifact types.
- Changes to `brain artifact batch` core logic.
- `derive-*` skill family. This tuning pass gates that work; does not start it.

---

## Success criteria

Rerun the librarian on the same 21 mm chunks after A–D ship. Backup the current brain first (`brain backup --target meta/brain.db.pre-skill-tuning-bk`) so the pre-tuning corpus is preserved for comparison.

**Measurable:**
- `decision` count drops from 72 to ≤40 (target ~30 — i.e. ~40% reduction).
- `intent` count collapses from 5 to 2–3 (the three Knowledge-OS entries merge).
- `future_idea` count drops by ≥2 (Observer Mode collapses, at minimum).
- `todo` count rises by ≥3 (items currently miscategorized as decisions surface).
- At least some artifacts carry `decided_by` when chain messages are present in chunks.
- `filterMechanical` v2 unit test passes.

**Qualitative:**
- Pick 5 random decisions from pre- and post-tuning corpora side by side. Post-tuning decisions should more clearly pass the decision test.

If the measurable targets miss by a lot (e.g. decisions only drop to 60, intents don't collapse), the issue is deeper than skill wording and the next pass is cross-type supersession, not more tuning.

---

## Risks

- **Overshoot.** If the decision test is too strict, real decisions land as intents. Mitigate: keep the pre-tuning backup; compare 5 random decisions side by side before committing.
- **Canonical map rot.** The synonym map will grow over time. Keep it in the skill file (data, versioned in git), not in TS code, so it evolves with the skill.
- **Chain-footer parser brittleness.** If the chain message format shifts (field order, indentation), the regex misses. Mitigate: test against real chain transcripts from `ac_ceo` in current wgd chain before landing.
- **Filter-version bump side-effects.** Bumping `FILTER_VERSION` invalidates cached chunk reads. Re-runs on the same chunks are fine (the filter is idempotent); but verify `brain chunk read` still works against v1-stamped `chunks_virtual` rows.

---

## Handoff

- Work on a branch. Commit in steps: filter change + skill rewrite + verification rerun.
- Test on mm first (the 21 chunks we already have). Don't touch ac / newproj corpora during validation.
- Update `meta/skills/ingest.md` as the single source of truth for type boundaries and the canonical map. The spec doc you're reading now is scaffolding, not the shipped artifact.
- Leave the pre-tuning DB backup on disk. CTO will compare before greenlighting `derive-*`.

## References

- Live corpus sample: `mcp__mm__list_artifacts` output 2026-04-20 (decisions #93 #82 #104; intents #10 #76 #39; future_ideas #51 #58).
- v11 plan: `agent/docs/2026-04-20-v11-plan.md` (addenda A3 / A5 / A8).
- Current skill: `meta/skills/ingest.md`.
- Current filter: `src/narrative.ts`.
- DevOps handoff (v11 + v11.2 audit state): `agent/roles/devops/handoff.md`.

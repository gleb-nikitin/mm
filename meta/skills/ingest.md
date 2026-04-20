---
name: ingest
description: Read one chunk. Extract every signal as atomic artifact rows in a single batch. No wiki-page maintenance.
---

# Skill: Ingest (v11 — atomic artifacts)

One chunk → one scan → one `brain artifact batch` call → `brain chunk mark-processed`.

No wiki files. No markdown append. No file I/O at all. The DB is operational memory.

## Workflow

1. **Read the chunk**: `bun run brain chunk read <id>`. Metadata goes to stderr, content to stdout.
2. **Scan for signal** across the artifact types below. Most chunks have 2–4 populated types. Many have none — that is valid.
3. **Compute a stable `idempotency_key`** per artifact using the canonical-form rule in the "Idempotency keys" section below. Re-reading the same chunk must produce the same keys so `brain artifact batch` deduplicates. Rephrases must collapse to the same key.
4. **Check the "Known Artifacts" list** (injected into your session prompt by `process-new.command`). If your candidate `idempotency_key` is already there, skip it — don't re-emit. Canonical-form keys make this check the primary dedup lever.
5. **Apply the re-classification rule** (below) before emitting. If you are about to emit more than two `decision` artifacts from a single chunk, re-read each against the decision test and demote failures.
6. **Emit ONE `brain artifact batch` call** with all remaining artifacts. Pipe JSON to stdin. Core-side upsert handles dedup as a safety net.
7. **Explicit supersession only**: if the chunk itself shows a direct contradiction with a known active artifact ("we previously decided X, but now…"), emit `brain artifact supersede <old-id> <new-id>` after the batch. Do not scan the artifact table hunting for implicit contradictions.
8. **Corrections**: before emitting a new `correction`, check the "Known Artifacts" list for a matching `previous_belief` / `corrected_view`. If matched, call `brain artifact bump-correction <id>` instead of creating a duplicate.
9. **Mark consumed**: `bun run brain chunk mark-processed <id>`.

## Artifact types

Emit to `brain artifact batch` with this JSON shape per artifact:

```json
{
  "project": "mm",
  "type": "<type>",
  "idempotency_key": "<stable-key>",
  "sources": [
    { "source_event_id": <raw_events.id>, "span_start": <int|null>, "span_end": <int|null> }
  ],
  "data": { ... type-specific fields below ... }
}
```

`sources` carries provenance — at minimum include the `source_event_id` of the event this chunk came from (see chunk read's stderr metadata). If the artifact draws on multiple chunks' worth of context, include one source entry per chunk.

### Per-type `data` shapes

| Type | `data` fields |
|------|---------------|
| `decision` | `statement`, `rationale`, **`alternatives_rejected: [{option, why_rejected}]`** (see below), `area`, `decided_by?` |
| `stack_decision` | `technology`, `chosen_over: [alt]`, `rationale`, `decided_by?` |
| `bug` | `symptom`, `context`, `severity: low|medium|high`, `status: open|fixed|wontfix` |
| `todo` | `statement`, `effort: small|medium|large`, `area`, `decided_by?` |
| `intent` | `statement`, `horizon: session|milestone|project`, `alignment_check`, `decided_by?` |
| `howto` | `problem`, `steps: [string]`, `verification` |
| `tool_error` | `tool`, `error_message`, `agent_reasoning`, `resolution` |
| `code_doc` | `area`, `summary`, `components: [{name, role}]` |
| `correction` | `previous_belief`, `corrected_view`, `count` (initial: 1), `last_seen` (ISO date) |
| `friction` | `pattern`, `frequency_estimate`, `first_seen` |
| `user_note` | `note` |
| `future_idea` | `statement`, `why_interesting` |

Unknown types pass through — the schema does not reject. Prefer the canonical types above.

### On `alternatives_rejected` (critical for `decision` artifacts)

A decision without its rejected alternatives loses the "why not X" context — the most valuable part of a decision log. **Always scan the chunk for the options that were discussed and dropped.** Pattern in conversation is usually one of:

- "we could do X, but let's go with Y because..." → `alternatives_rejected: [{option: "X", why_rejected: "..."}]`
- "A vs B vs C → picked B" → `alternatives_rejected: [{option: "A", why_rejected: "..."}, {option: "C", why_rejected: "..."}]`
- Agent proposes approach X, user redirects to Y → X is rejected
- "thought about doing it inline but moved it to a junction table" → inline is rejected

If the chunk genuinely contains no alternatives (the decision was unilateral and no options were weighed), use `alternatives_rejected: []` — an empty list is still explicit. **Do not omit the field.** The empty list tells future readers "this wasn't a weighed tradeoff" as distinct from "we don't know what was considered."

### Speaker attribution (`decided_by`)

Optional field on `decision`, `stack_decision`, `todo`, `intent`. Populate **only** when the originating chunk contains a `[chain-msg from=<id> to=<id>]` marker emitted by the narrative filter (v2+). Value is the participant id of whoever actually authored or ratified the item — draw from the marker plus surrounding chunk context (CTO dispatching, owner approving a proposal, etc.).

Omit the field entirely when no marker is present. Absent means session transcript with implicit "user" semantics.

Forward-compatible with the v12 briefing surface: owner decisions weight heavier than agent-proposed ones. Don't invent attributions without a marker.

## Idempotency keys

Key shape: `<type>:<project>:<canonical-slug>`.

Compute the canonical slug:

1. **Start from the core field.** `decision.statement`, `bug.symptom`, `todo.statement`, `intent.statement`, `future_idea.statement`, `correction.previous_belief`, `friction.pattern`, etc. Use the most-identifying field for the type.
2. **Lowercase.**
3. **Strip stopwords and product-specific prefixes.** Drop leading verbs like `implement`, `adopt`, `transition`, `transform`, `mandate`, `establish`, `enable`, `create`, `execute`, `define`, `require`. Drop product names when they add no uniqueness ("mm", "mnemonic51", "the librarian"). Drop vacuous phrases ("for the project", "as the required foundation", "for scaling").
4. **Apply the synonym map below.** Collapse each recognized phrase to its canonical term. Apply longest-match first.
5. **Slugify** the remaining phrase: lowercase, hyphen-separated, alphanumeric only, no trailing/leading hyphens.

Two artifacts of the same type about the same underlying idea must produce identical keys after this pipeline. Rephrases are the common failure mode — the synonym map is the primary defense.

### Canonical-term synonym map

Starter map. Extend as the live corpus reveals new clusters; keep additions here in the skill file, not in TS code.

| Canonical | Matched phrases (any form, lowercased) |
|-----------|-----------------------------------------|
| `knowledge-os` | knowledge operating system, knowledge os, knowledge-os, dynamic knowledge operating system, unified knowledge layer, unified knowledge store |
| `observer-mode` | observer mode, observer, file-watching, file watching, file watcher, automated file watching, background indexing, background file-watching |
| `atomic-pivot` | atomic artifacts, atomic extraction, atomic pivot, atomic architecture, atomic knowledge architecture, atomic artifact model, atomic knowledge, v11 atomic, v11 atomic pivot, v11 atomic architecture, v11 atomic artifact model, v11 artifacts schema, polymorphic artifacts table |
| `virtual-chunks` | virtual chunks, chunks virtual, chunks_virtual, in-memory narrative windows |
| `bump-correction` | bump-correction, bump correction, brain artifact bump-correction, bump-correction cli, bump-correction verb |
| `minimal-agent-config` | minimal claude md, minimal claude.md, minimal agent config, minimal agent configuration, minimal agent configuration files |
| `clean-break-migration` | clean break migration, clean-break migration |

When extending the map, prefer broad canonical terms that survive the next rephrase round. A one-off synonym pair that will never recur is not worth a map entry.

## Signal calibration

Every candidate artifact passes an explicit type test before emission. If a statement fails its type's test, it belongs in a different type or not at all.

### Decision test

A candidate is a `decision` only if **all three** hold:

1. **Alternatives visible.** A choice between ≥2 concrete options is present in the chunk (even if one option is "do nothing").
2. **Selection made.** One option is selected and the others explicitly dropped.
3. **Tradeoff rationale.** The rationale names a tradeoff between the options, not just a restatement of the chosen path.

If (1) and (2) hold but (3) is missing, still a `decision` — carry the dropped options in `alternatives_rejected` even without a strong rationale.

If (1) fails (no alternatives visible in the chunk), the candidate is **not** a decision. Choose one of:

- **`intent`** — if the statement names a long-horizon direction or vision.
- **`future_idea`** — if it names a concrete capability that *might* be built but isn't currently planned.
- **`todo`** — if it names a specific action with a clear end state.
- **Skip** — if it's rhetorical agreement ("yes, that's interesting") without substance.

### Intent test

A candidate is an `intent` when:

- It names a long-horizon direction or vision (not an action).
- No concrete actions are attached in the chunk.
- `horizon: project` is the common case. `horizon: milestone` and `horizon: session` require a scope marker in the chunk ("this sprint", "this session").

"Transform mm into a Knowledge OS" is an intent. "Implement observer mode" is a todo or future_idea, not an intent.

### Future_idea test

A candidate is a `future_idea` when:

- It names a concrete capability that *might* be built.
- It is not currently planned (no owner, no timeline).
- Distinct from `todo` (planned, scoped) and `intent` (direction, not capability).

### Todo test

A candidate is a `todo` when:

- It names a specific action with a clear end state ("implement X", "rip Y", "rewrite Z").
- The end state is verifiable.

"We should do X" where X is a concrete action is a `todo`, not a `decision` that X should happen. Decisions weigh alternatives; todos just specify the action.

### Correction test

A candidate is a `correction` when:

- A previously held belief or behavior is explicitly revised.
- Two shapes are first-class:
  1. **Factual**: "X was wrong; Y is actually true" — e.g. "the table has a FK, not a plain column."
  2. **Behavioral**: user-to-LLM operational feedback — e.g. "don't push to main", "send via Aurora not terminal text", "always stash unrelated changes before committing." These are CEO/user preferences that should persist across sessions.
- `previous_belief` captures what was being done wrong (behavior) or believed wrong (fact).
- `corrected_view` captures the correct behavior or fact.
- High-count corrections (≥3) surface in the v12 briefing, so behavioral corrections are the mechanism by which user preferences propagate without restating each session.

### Re-classification rule

If your first-pass extraction produces **more than two** `decision` artifacts from a single chunk, re-read every candidate decision against the decision test before emitting. Demote failures:

- No alternatives visible → `intent` / `future_idea` / `todo` (per above).
- Alternatives visible but no selection — skip (not yet a decision).
- Pure vision statement — `intent`.
- Pure concrete action — `todo`.

Most real chunks produce 0–2 decisions. More than that is the signal that over-extraction is happening.

### Skip

- Routine confirmations ("looks good", "ok", "done") with no substantive content.
- Context-setting that restates already-known facts.
- Pure debugging back-and-forth with no conclusion reached — wait for the conclusion.
- Output that duplicates an artifact already in the "Known Artifacts" block.

## Completion checklist

- [ ] `brain chunk read <id>` called.
- [ ] Each candidate passed its type test before emission.
- [ ] Re-classification sweep applied if >2 decisions emerged from first pass.
- [ ] Each `idempotency_key` computed via the canonical-form rule (synonym map applied).
- [ ] `decided_by` populated only when a `[chain-msg from=…]` marker is present.
- [ ] Single `brain artifact batch` call per chunk.
- [ ] Explicit `brain artifact supersede` calls only on direct contradictions.
- [ ] Correction duplication handled via `bump-correction`.
- [ ] `brain chunk mark-processed <id>` called.

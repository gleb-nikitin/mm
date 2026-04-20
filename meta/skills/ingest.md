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
3. **Compute a stable `idempotency_key`** per artifact: `<type>:<project>:<slug-of-core-field>` (e.g. `decision:mm:chunks-virtual-only`). Re-reading the same chunk must produce the same keys so `brain artifact batch` deduplicates.
4. **Emit ONE `brain artifact batch` call** with all artifacts from this chunk. Pipe JSON to stdin. Core-side upsert handles dedup — do NOT call `artifact list` first.
5. **Explicit supersession only**: if the chunk itself shows a direct contradiction with a known active artifact (the user or agent says "we previously decided X, but now…"), emit `brain artifact supersede <old-id> <new-id>` after the batch. Do not scan the artifact table hunting for implicit contradictions.
6. **Corrections**: before emitting a new `correction`, call `brain artifact list --project <p> --type correction` and match on `previous_belief` / `corrected_view`. If matched, call `brain artifact bump-correction <id>` instead of creating a duplicate.
7. **Mark consumed**: `bun run brain chunk mark-processed <id>`.

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
| `decision` | `statement`, `rationale`, `alternatives_rejected: [{option, why_rejected}]`, `area` |
| `stack_decision` | `technology`, `chosen_over: [alt]`, `rationale` |
| `bug` | `symptom`, `context`, `severity: low|medium|high`, `status: open|fixed|wontfix` |
| `todo` | `statement`, `effort: small|medium|large`, `area` |
| `intent` | `statement`, `horizon: session|milestone|project`, `alignment_check` |
| `howto` | `problem`, `steps: [string]`, `verification` |
| `tool_error` | `tool`, `error_message`, `agent_reasoning`, `resolution` |
| `code_doc` | `area`, `summary`, `components: [{name, role}]` |
| `correction` | `previous_belief`, `corrected_view`, `count` (initial: 1), `last_seen` (ISO date) |
| `friction` | `pattern`, `frequency_estimate`, `first_seen` |
| `user_note` | `note` |
| `future_idea` | `statement`, `why_interesting` |

Unknown types pass through — the schema does not reject. Prefer the canonical types above.

## Signal calibration

**Capture:**
- User explicitly states a decision, bug, todo, or correction.
- Agent proposes an approach and user agrees — that's a `decision`.
- Error, unexpected behavior, or broken assumption — `bug` or `tool_error`.
- User shares personal context, preferences, or intent — `user_note` or `intent`.
- User mentions a vision or plan that's not yet concrete — `future_idea`.
- A better tool or method replaces a worse one — `correction`.

**Skip:**
- Routine confirmations ("looks good", "ok", "done").
- Context-setting that restates already-known facts.
- Pure debugging back-and-forth with no conclusion reached — wait for the conclusion.
- Output that duplicates an artifact already known to be in the DB from this same chunk.

## Completion checklist

- [ ] `brain chunk read <id>` called.
- [ ] Each populated type emitted with a stable `idempotency_key` and at least one `sources` entry.
- [ ] Single `brain artifact batch` call per chunk (not one call per artifact).
- [ ] Explicit `brain artifact supersede` calls only where the chunk shows a direct contradiction.
- [ ] Correction duplication handled via `bump-correction`.
- [ ] `brain chunk mark-processed <id>` called.

## Token budget

Target ≤5% of the session window per chunk. The v10 monolithic-wiki-page model cost ~15% (most of it was markdown formatting). If your chunk takes more than 5%, you are probably re-writing when you should be emitting JSON.

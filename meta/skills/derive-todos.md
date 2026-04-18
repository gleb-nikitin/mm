---
name: derive-todos
description: Read a freshly ingested research source and the project's current todo/roadmap, then propose concrete, grounded todo additions mapped to the project's actual gaps.
---

# Skill: Derive Todos

Complements the `ingest` skill. Where `ingest` produces the **knowledge layer** (a wiki page summarizing a source), `derive-todos` produces the **action layer** (concrete additions to `agent/docs/todo.md` grounded in that source).

Use this whenever an ingested source contains **opinions about how the project should change** — not just facts. Concretely:

- **Research sources** — external projects, blog posts, papers, systems, talks. Proposals about architecture, features, retrieval, data model.
- **Agent exit interviews / handoffs** — agents finishing a session and saying what they want changed. Proposals about process, missing docs, role boundaries, operational friction. This is how a project self-evolves: agents leave opinions, the skill turns opinions into actions, the next agent reads the updated todo.
- **User feedback / bug reports / usability notes** — proposals about UX, priorities, polish.
- **Post-mortems** — proposals about what to prevent.

The skill is source-type agnostic. What matters is whether the input contains claims about "what should change" that need to be grounded in mm's current state before they become actions.

## Why this exists

`ingest` turns a raw source into compiled truth ("what does this source say?"). It does **not** answer "what should mm do about it?" Deciding that requires:

- Awareness of mm's current architecture (`src/`, `meta/schema.md`).
- Awareness of what's already planned (`agent/docs/todo.md`).
- Awareness of mm's direction (`agent/docs/roadmap.md`).
- Awareness of explicitly known gaps (`meta/remaining-gaps.md`).

A fresh ingest pass doesn't have that context unless you give it to the skill deliberately. This skill gives it.

## Inputs

Read these files, in order, before producing any output:

1. **The research source** — either the raw entry at `raw/research/<project>/*.md` or the compiled wiki page (`wiki/<SourceName>.md`). The wiki page is usually enough.
2. **`agent/docs/todo.md`** — the prioritized list. Know what's already captured before proposing anything.
3. **`agent/docs/roadmap.md`** — project direction and two-track plan (Light vs Hardcore).
4. **`meta/schema.md`** — the data model. Grounds proposals in concrete schema touch-points.
5. **`meta/remaining-gaps.md`** — explicitly named open gaps; high-value targets for matching research insights.

## Workflow

1. **Extract candidate ideas** from the research source. For each concept, pattern, or claim, note: what is it, what problem does it solve, what's the proposed mechanism.
2. **Filter for mm-applicability**:
   - Does mm have the problem this solves? (Reject: "Kubernetes autoscaling" — not mm's problem.)
   - Does mm already plan to do this? (Reject: duplicates of existing todo entries.)
   - Is the mechanism compatible with mm's shape (TS/Bun Light, Rust Hardcore)? (Reject: requires a runtime mm rejects.)
   - Is the change concrete enough to land, or is it aspirational framing? (Reject: pure philosophy with no action.)
3. **Map each survivor to an existing todo section** or flag it as a **new section**. Prefer existing sections — a todo list with ten new top-level items is a failure of this skill.
4. **Ground every proposal** with a direct citation to the research source — wiki slug and optionally a specific section — and a direct pointer to the mm code or doc it touches.
5. **Draft the addition** in the existing todo.md style: tight, actionable, specific file paths where relevant.

## Output format

Produce a **diff-style proposal**, not a rewrite. One block per proposed todo addition:

```
### Proposal for todo.md {section}: {short title}

Source: [[{WikiSlug}|{Title}]] (raw/research/{project}/{filename}.md, section "{subsection}")
Mapped to: {existing 4b / 5c / etc., OR "new subsection"}
Rationale: {one sentence why this is worth doing in mm specifically}

Draft text:
> {the actual bullet/paragraph to paste into todo.md}
```

After all proposals, end with a one-line summary:

```
Summary: N proposals mapped to {list of existing sections}, M proposals in new sections.
```

## Quality bar

- **Specific.** "Add HNSW vector index under 5e, pointed at sqlite-vec" — not "explore better vector search."
- **Grounded.** Every proposal cites a wiki slug **and** names the mm file/section it touches.
- **De-duped.** If todo.md already plans it, skip or propose a tightening, not a repeat.
- **Honest about fit.** If a research idea is cool but doesn't fit mm, say so in a "Rejected" block at the end with a one-line reason. That's data too.

## What NOT to do

- Do NOT edit `agent/docs/todo.md` directly in this pass. Output proposals; a human or a follow-up pass decides what to apply.
- Do NOT create new wiki pages. That's `ingest`'s job.
- Do NOT re-summarize the research source. That's `ingest`'s job — the wiki page already has the compiled truth. Reference it; don't duplicate it.
- Do NOT propose vague meta-work ("improve documentation", "add more tests"). Every proposal must be concrete enough that a future session can pick it up cold.

## Completion checklist

- Read source + todo + roadmap + schema + remaining-gaps (all five).
- Every proposal cites a wiki slug and a target mm location.
- No duplicates of existing todo entries.
- Rejected ideas listed with reason.
- Summary line at the end.
- (Optional) Log a one-liner to `meta/log.md` — "Derived N proposals from [[SourceSlug]]" — so the audit trail captures this pass.

---
name: ingest
description: Read one raw chunk once and extract all valuable content into the relevant wiki pages in a single pass.
---

# Skill: Ingest

Read a chunk once. Extract everything useful. Append to the right pages. One pass, no waste.

## The Extraction Buckets

For each chunk, check each category. Append findings to the wiki page. Skip categories with no signal — that is valid.

| Category | Wiki Page | What to capture |
|----------|-----------|-----------------|
| Decisions | `wiki/<project>/Arch_Decisions.md` | What was chosen, what was rejected, why |
| Bugs | `wiki/<project>/Known_Bugs.md` | Defects found, broken behaviors, unexpected edge cases |
| Tasks | `wiki/<project>/Future_Tasks.md` | Concrete work items discussed, improvements planned |
| Friction | `wiki/<project>/Friction_Points.md` | Pain points, repeated complaints, workflow blockers |
| Code changes | `wiki/<project>/Code_Changes.md` | Important logic changes, refactors, new behavior |
| How it works | `wiki/<project>/How_It_Works_Now.md` | Current behavior explained, architecture clarified |
| User info | `wiki/<project>/User_Notes.md` | Context the user shares about themselves, preferences, situation |
| Corrections | `wiki/<project>/Corrections.md` | Wrong assumptions fixed, better tools or approaches identified |
| Future ideas | `wiki/<project>/Future_Ideas.md` | Visions, plans, "someday" thoughts not yet concrete tasks |

## Workflow

1. Read the chunk: `bun run brain read-raw <id>`. Note its `source_type`, `project`, path.
2. Scan for signal. Most chunks have 2–4 populated categories. Many have zero — mark processed and move on.
3. For each category with signal:
   - Open the wiki page (create if it doesn't exist — see format below).
   - Append one or more bullet entries under `<!-- ENTRIES: append-only below this line -->`.
4. Mark processed: `bun run brain mark-processed <id>`.
5. Log: one line to `meta/log.md`.

## Entry format

```
- **YYYY-MM-DD** [project]: <1–2 sentences of substance>. Source: `raw/<source_type>/<project>/<file>.md`
```

Dense. No padding. The substance is the value.

## Page format (when creating)

```markdown
---
title: <Title>
slug: <Slug>
tags: [extracted]
type: analysis
status: active
created_at: <date>
updated_at: <date>
---

# <Title>

<!-- ENTRIES: append-only below this line -->
```

No Summary section. No Cross-References. Just the growing entry log.

## Signal calibration

**Capture:**
- User explicitly states a decision, bug, plan, or correction
- Agent proposes an approach and user agrees
- Something breaks or is identified as wrong
- User shares personal context, preferences, or situation
- User mentions a future idea or vision
- A better tool or method is identified for something done a harder way

**Skip:**
- Tool call output, file contents echoed back
- Routine confirmations ("looks good", "ok", "done")
- Context-setting that restates already-known facts
- Pure debugging back-and-forth with no conclusion reached

## Completion checklist

- [ ] Chunk read.
- [ ] Each populated category appended to its page.
- [ ] Empty categories skipped — not forced.
- [ ] `brain mark-processed <id>` called.
- [ ] One line in `meta/log.md`.

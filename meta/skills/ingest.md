---
name: ingest
description: Process one raw source into the wiki by finding candidate pages, updating or creating pages, preserving provenance, and logging the operation.
---

# Skill: Ingest

Use this when new material has been added to `/raw/` and should be incorporated into `/wiki/`.

## Goal

Turn raw material into durable wiki updates using the **New Page Model**. A good ingest pass produces a small number of high-quality wiki updates, not one update per topic mentioned.

## Raw entry shape

Raw files live under `raw/<source_type>/<project>/<timestamp>.md`. Legacy flat files under `raw/*.md` still exist. Use the full path verbatim in Timeline citations.

`source_type` tells you what kind of material you're reading:

- `claude`, `telegram`, `chains` — **chat transcripts**. Long, multi-topic, turn-structured. Most turns are noise (tool calls, corrections, context-setting). Skim the transcript and extract only durable subjects — decisions made, concepts explained, named entities, product direction. Do NOT create a wiki update per turn. Target 0–5 wiki subjects per session file.
- `docs`, `research`, `knowledge` — **structured content**. Usually one primary subject per file. One or two wiki updates is typical.
- `raw` (legacy / hand-added) — treat as a single snippet, extract the obvious subject.

`project` is the domain slug (e.g. `mm`, `ac`). Use it when the subject itself is project-specific (e.g. if a chat discusses a project's architecture, the wiki page for that architecture should reference the project by name, and the Timeline bullet should cite the source file whose path already encodes the project).

## Workflow

1. Read the raw entry. Note its `source_type`, `project`, and file path.
2. Identify durable subjects worth a wiki page. Favor:
   - Named entities (people, products, projects, tools).
   - Decisions made and their rationale.
   - Concepts or patterns worth reusing elsewhere.
   - Cross-references that would make the brain more navigable.
   Reject: one-off debugging details, tool output, commands executed, environment quirks that don't generalize.
3. For each subject, search `/wiki/` (by exact slug, alias, or FTS). Choose:
   - **Create** — no existing page covers this subject.
   - **Update** — existing page exists; add evidence and refresh Summary.
   - **Skip** — subject is not durable or is already sufficiently covered.
4. **Create Page**:
   - Use `bun run brain page create`.
   - Set `type` (entity / concept / source / analysis), `confidence`, `mentions`, `tier`.
   - Write the **Compiled Truth** as `## Summary`.
   - Pass `--source <raw_id>` and `--claim "..."` so provenance is recorded in `claim_sources`.
5. **Update Page**:
   - Use `bun run brain page update`.
   - Rewrite **Compiled Truth** (Summary) to include the new information. Do not simply append a sentence — integrate.
   - Append the new evidence bullet to the **Timeline** (below the `---` separator and the `<!-- TIMELINE: ... -->` marker), citing the full raw path.
   - Pass `--source <raw_id>` and `--claim "..."`.
6. **Append a log entry to `meta/log.md`.** This is not optional — see the "Audit trail" section below for format and rationale.

## Timeline bullet format

Every new Timeline bullet must cite the raw file by its full current path:

```
- **2026-04-18**: Decided to ship mm in two tracks (Light in TS/Bun, Hardcore in Rust on ac shell + tabularium). Source: `raw/claude/mm/2026-04-18T…Z.md`
```

Do NOT use the flat-legacy form (`raw/example.md`) for files that live under a nested path.

## New Model Rules

- **Compiled Truth**: always above the `---` separator. Represents the current best understanding, rewritten on each update.
- **Timeline**: always below the `<!-- TIMELINE: append-only below this line -->` marker. Append-only. Never edit or delete existing bullets.
- **Frontmatter**: on update, bump `mentions`, revisit `confidence` and `tier` if signal is materially stronger.

## Chat-transcript specific guidance

When ingesting a `claude`/`telegram`/`chains` session:

- Read the transcript end-to-end. Most value concentrates in the last third (decisions, refined conclusions).
- Ignore tool calls (shown as `[tool: Name]`) unless the operation itself became a durable decision ("we added a runGemini async fix").
- Compress each durable subject into a single Timeline bullet. Don't serialize the back-and-forth — extract the conclusion.
- If the session is about the mm project itself (meta-work on mm), be careful: wiki pages about mm's architecture should reflect the decided state, not the discussion state. Prefer updating existing mm-related pages over creating new ones.

## Audit trail — hard requirement

**An ingest pass is not complete until `meta/log.md` has a new line.** The log is mm's human-readable audit of every brain mutation. Without it, future agents cannot tell which wiki updates came from which ingest run, and the self-evolution loop breaks silently.

This is a hard gate because in practice agents have skipped the log write on two consecutive passes. Treat it with the same weight as the wiki writes themselves.

### Log line format

One line per ingest pass, dated, listing what happened:

```
- 2026-04-18: Ingest — <N> created, <M> updated from `<raw-path>`. Pages: [[Slug1]], [[Slug2]], [[Slug3]]
```

Examples:

```
- 2026-04-18: Ingest — 4 created, 0 updated from `raw/claude/mm/2026-04-17T21-06-05-140Z.md`. Pages: [[Mnemonic_Light]], [[Mnemonic_Hardcore]], [[Mnemonic_Ingestion_Pipeline]], [[Mnemonic_UI]]
- 2026-04-18: Ingest — 2 created, 3 updated from `raw/research/mm/2026-04-18-gbrain.md`. Created: [[GBrain]], [[Mnemonic_Synthesis_Briefing]]. Updated: [[Mnemonic_Light]], [[Mnemonic_Hardcore]], [[Mnemonic_Ingestion_Pipeline]]
- 2026-04-18: Ingest — 0 created, 0 updated from `raw/claude/mm/<session>.md`. Source skipped: no durable subjects (pure debugging session).
```

Skip runs also get a line — "skipped" is valid data.

## Completion Checklist

The ingest pass is done **only when all of these are true**. If any one fails, the pass is incomplete.

- [ ] Raw file read and durable subjects identified (or explicitly none — skip is a valid outcome).
- [ ] Pages created or updated using the harness.
- [ ] **Timeline preserved and appended to** for every updated page, with citations to the full nested `raw/<source_type>/<project>/…` path.
- [ ] **Summary (Truth) updated** to reflect the new state on every updated page.
- [ ] **`meta/log.md` updated** — one line per ingest pass, dated, in the format above. No log line = the pass did not happen.

---
name: ingest
description: Process one raw source into the wiki by finding candidate pages, updating or creating pages, preserving provenance, and logging the operation.
---

# Skill: Ingest

Use this when new material has been added to `/raw/` and should be incorporated into `/wiki/`.

## Goal

Turn raw material into durable wiki updates using the **New Page Model**.

## Workflow

1. Read the raw entry and identify durable subjects.
2. Search `/wiki/` for existing pages (exact slug or alias).
3. For each subject, choose: **Create**, **Update**, or **Skip**.
4. **Create Page**:
   - Use `bun brain.ts page create`.
   - Set `type`, `confidence`, `mentions`, and `tier`.
   - Write the **Compiled Truth** in `## Summary`.
   - Use `--source <id>` and `--claim "..."` flags.
5. **Update Page**:
   - Use `bun brain.ts page update`.
   - Rewrite the **Compiled Truth** (Summary) to include new info.
   - Append the new evidence bullet to the **Timeline** (below the `---` separator).
   - Use `--source <id>` and `--claim "..."` flags.
6. Append a log entry to `meta/log.md`.

## New Model Rules

- **Compiled Truth**: Always above the `---` separator. Represents current best understanding.
- **Timeline**: Always below the `<!-- TIMELINE: ... -->` comment. Append-only bullets with `raw/` citations.
- **Frontmatter**: Update `confidence`, `mentions`, and `tier` if significant new info is added.

## Completion Checklist

- Raw file read and subjects identified.
- Pages created or updated using the harness.
- **Timeline preserved and appended to.**
- **Summary (Truth) updated to reflect the new state.**
- `meta/log.md` updated.

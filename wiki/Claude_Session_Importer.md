---
title: Claude Session Importer
slug: Claude_Session_Importer
aliases:
  - import-claude.ts
tags:
  - concept
  - mnemonic
  - importer
type: concept
confidence: 0.9
mentions: 4
tier: 2
status: active
created_at: '2026-04-17T21:40:16.402Z'
updated_at: '2026-04-18T12:00:00.000Z'
source_count: 3
---

# Claude Session Importer

## Summary
A TypeScript script (scripts/import-claude.ts) that normalizes and ingests Claude session transcripts into the raw/ repository. It extracts conversation text while collapsing tool calls and skipping results to reduce noise. It supports project-specific tagging based on the session's CWD and uses hash-based deduplication for safety. Key flags include --days (mtime filter), --project (substring match on cwd), --min-turns (filter trivial sessions), --include-thinking, and --dry-run.

## Cross-References
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Created `scripts/import-claude.ts` to normalize and ingest Claude session transcripts into the `raw/` repository with project-specific tagging. Source: `raw/claude/mm/2026-04-17T21-36-21-543Z.md`
- **2026-04-18**: Ported Claude session log parsing to TypeScript (scripts/import-claude.ts) to maintain a single runtime and support project-specific tagging. Source: `raw/claude/mm/2026-04-17T21-06-05-140Z.md`

- **2026-04-18**: Detailed import-claude.ts flags (--days, --project, --min-turns) and content filtering logic (collapsing tools, hash dedup). Source: `raw/docs/mm/2026-04-17T21-35-18-150Z.md`
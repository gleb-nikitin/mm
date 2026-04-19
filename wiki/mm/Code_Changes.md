---
title: Code Changes
slug: code-changes
tags: [extracted]
type: analysis
status: active
created_at: 2026-04-20
updated_at: 2026-04-20
---

# Code Changes

<!-- ENTRIES: append-only below this line -->
- **2026-04-20** [mm]: Schema v10 update: added `raw_events.chunked` column; updated `core.ts` `initDb()` and `scripts/chunk-events.ts` to support this tracking. Source: `raw/docs/mm/how-to-import.md`
- **2026-04-20** [mm]: Added `runGeminiInteractive` to `src/core.ts`: uses `gemini -i` and inherits stdio for user interaction. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`
- **2026-04-20** [mm]: Added `process-interactive` command to `src/brain.ts`: implements the interactive Librarian ingestion logic. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`

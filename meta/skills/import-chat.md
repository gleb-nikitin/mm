---
name: import-chat
description: Convert a chat history into raw entries that preserve chronology and are ready for ingest into the maintained wiki.
---

# Skill: Import Chat

Use this when importing chat history from Telegram or similar sources.

## Goal

Transform chat history into stable raw entries, then make them available for the ingest workflow.

## Principles

- raw imports should be immutable
- preserve dates and source labels
- split by meaningful chronological unit
- do not synthesize directly into the wiki during the raw import step

## Workflow

1. Read the source chat export.
2. Split it into chronological slices that are small enough to process safely.
3. For each slice, write a raw markdown file with:
   - title
   - source name
   - date or date range
   - raw body
4. Register or record the import in the operational log if the workflow requires it.
5. Hand the imported raw files to the `ingest` skill.

## Good Slice Boundaries

- one day
- one conversation segment
- one topic burst

Use the smallest unit that preserves meaning without flooding the queue with noise.

## Post-Import Expectations

After import:

- raw entries exist in `/raw/`
- ingest can process them one by one
- provenance back to the chat slice is preserved

## Do Not

- paraphrase away important source detail during import
- mix multiple unrelated time periods into one raw file unless necessary
- bypass raw storage and write directly into `/wiki/`


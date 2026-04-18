# Handoff: mm_lib

## Current State
- **Wiki**: 12 pages total. New research foundations (LLM_Wiki, GBrain, Cross-Chat) ingested.
- **Schema**: v4 (Source/Project separation) landed and verified.
- **Architecture**: Decided on Dual-Root Raw (Docs=MD, Chats=DB).
- **UI**: Aurora-themed Alpine UI serving at `/`.

## Blockers
- **Preamble Tax**: Still reading `ingest.md` and `schema.md` on every turn.
- **Sync Friction**: No automatic file-watcher for `raw/` updates.

## Next Steps
1. Implement the `raw_events` table for direct-to-DB chat imports.
2. Port the `process-new.command` logic into a production-ready `scheduler.ts`.
3. Add the `fresh-session` stop-marker logic to the `brain` CLI.
4. **Briefing Ownership**: I have created and now own `agent/roles/lib/briefing.md`. All future mm_lib agents should update this file when the foundational mission or core workflows evolve.

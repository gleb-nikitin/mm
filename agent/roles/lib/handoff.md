# Handoff: mm_lib

## Current State (2026-04-21)
- **Queue**: ✨ Empty. 52 chunks processed and marked.
- **Corpus**: ~150+ atomic artifacts extracted (Decisions, Intents, Bugs, Friction, etc.).
- **Stability**: v11 "Atom Factory" model is now the proven standard for high-volume synthesis.

## Sharp Edges (Wish I Knew)
- **API Instability**: Provider-side issues can cause thrashing; always check `brain_stats` vs qualitative key audits to ensure extraction quality didn't degrade during high-latency periods.
- **Handoff Echo**: The `process-new.command` previously injected my own handoff back into my prompt, causing me to "recommend" things I'd already planned. This is now fixed, but watch for other "agent-reflexive" context loops.
- **SQL Foreign Keys**: Ad-hoc `bun:sqlite` scripts default `foreign_keys = OFF`. Always set `PRAGMA foreign_keys = ON` in wipe scripts to avoid orphaned provenance rows.

## Next Strategic Moves
1. **v12 Briefing Protocol**: Close the loop by pushing artifacts into new session preambles.
2. **Semantic Dedup**: Move beyond lexicographical idempotency to vector-based similarity to collapse rephrased artifacts.
3. **Synthesis Provider**: Abstract the LLM interface to allow for provider-swapping during API outages.

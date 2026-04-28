# Remaining Gaps vs Plan

This file tracks the delta between the implemented system and the current roadmap in `agent/docs/roadmap.md`.

## Metadata & Maintenance

- [x] **Tier Promotion**: Basics (T3 -> T2) implemented in `dream`.
- [x] **Citation Repair**: Obvious edit-distance fixes implemented in `dream`.
- [ ] **Conflict Resolution**: Contradictory evidence in the timeline is currently left for the LLM to resolve in the Compiled Truth section. No deterministic conflict-flagging exists yet.

## Ingestion

- [ ] **Create-vs-Update Confidence**: The decision to create a new page versus updating an existing one is mostly model-driven. 
- [ ] **Bulk Import**: Currently, ingestion is one-by-one. Large-scale history imports may need a batch mode to avoid prompt overhead.

## Performance & Search

- [x] **Semantic Retrieval**: Hybrid FTS5 + Vector (RRF) implemented.
- [ ] **Embedding Latency**: As the brain grows, JS-side cosine similarity calculation may become a bottleneck. We might need to move vector search back into a native SQLite extension if latency exceeds 500ms.
- [ ] **Search Weights**: Current RRF and Truth-boost are hardcoded. A plugin might need to configure these.

## External Surfaces

- [x] **Markdown HTTP API**: Implemented as requested in Phase 6.
- [x] **Upgraded MCP**: Exposes tools: `search_brain`, `query_brain`, `add_to_brain`, `validate_claim`, `brain_stats`, `list_projects`, `list_active_agents`, `embed_brain` (see `src/mcp.ts`).
- [/] **Web UI**: R1 monitor UI landed (index + 4 debug-first pages). Still lacks a stylized frontpage for the general knowledge base (currently Markdown-only).
- [ ] **Interactive MCP**: Search results return structured data, but could support richer "follow-up" actions (like reading a specific chunk's parent page).

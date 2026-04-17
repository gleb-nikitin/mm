# Remaining Gaps vs Plan

This file tracks the delta between the implemented system and the original `plan.md` or the updated `roadmap-2.md`.

## Metadata & Maintenance

- [ ] **Advanced Tiering**: The logic for promoting pages from Tier 3 to Tier 2 is implemented based on mentions, but higher-level tiering (Tier 1) and status transitions (archiving) remain manual or basic.
- [ ] **Conflict Resolution**: Contradictory evidence in the timeline is currently left for the LLM to resolve in the Compiled Truth section. No deterministic conflict-flagging exists yet.

## Ingestion

- [ ] **Create-vs-Update Confidence**: The decision to create a new page versus updating an existing one is mostly model-driven. 
- [ ] **Bulk Import**: Currently, ingestion is one-by-one. Large-scale history imports may need a batch mode to avoid prompt overhead.

## Performance

- [ ] **Embedding Latency**: As the brain grows, JS-side cosine similarity calculation may become a bottleneck. We might need to move vector search back into a native SQLite extension if latency exceeds 500ms.

## External Surfaces

- [ ] **Web UI**: The system lacks a dedicated stylized frontend (HTTP surface is Markdown-only).
- [ ] **MCP Contract**: Search results currently return strings/JSON; richer interactive contracts for backlink navigation could be improved.

---
title: GBrain
slug: GBrain
aliases:
  - Garry Tan's Brain
tags:
  - entity
  - project
type: entity
confidence: 1
mentions: 1
tier: 2
status: active
created_at: '2026-04-17T21:52:44.297Z'
updated_at: '2026-04-17T21:52:44.297Z'
source_count: 1
---

# GBrain

## Summary

GBrain is a personal memory engine for AI agents developed by Garry Tan, powering systems like OpenClaw and Hermes. It employs a 25-skill resolver system (e.g., signal-detector, brain-ops, media-ingest) and a hybrid search architecture (vector + keyword + RRF fusion + multi-query expansion + 4-layer dedup). The architecture typically involves a CLI or MCP Server communicating with a BrainEngine using PGLite or Supabase for storage. GBrain pioneered the 'compiled truth + timeline' knowledge model, where a synthesized summary represents the current best understanding while an append-only timeline preserves all evidence.

## Cross-References
- [[Garry_Tan|Garry Tan]]
- [[Mnemonic_Light|Mnemonic Light]]
- [[Mnemonic_Ingestion_Pipeline|Mnemonic Ingestion Pipeline]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Analyzed GBrain's skill-based architecture and 'compiled truth + timeline' knowledge model for adoption in Mnemonic51. Source: `raw/research/mm/2026-04-18-gbrain.md`
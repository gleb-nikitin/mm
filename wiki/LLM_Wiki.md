---
title: LLM Wiki
slug: LLM_Wiki
aliases:
  - LLM OS
  - Persistent Wiki
tags:
  - concept
  - research
type: concept
confidence: 1
mentions: 1
tier: 2
status: active
created_at: '2026-04-17T21:52:44.238Z'
updated_at: '2026-04-17T21:52:44.238Z'
source_count: 1
---

# LLM Wiki

## Summary
A pattern for building personal knowledge bases, famously described by [[Andrej_Karpathy|Andrej Karpathy]] as an 'LLM OS', where an LLM agent incrementally builds and maintains a persistent, structured, interlinked collection of markdown files (a wiki). Unlike traditional RAG, knowledge is compiled once into the wiki and kept current, creating a compounding artifact. The architecture consists of three layers: immutable raw sources, the LLM-owned wiki (directory of generated markdown), and a schema document defining workflows. Core operations include Ingest (reading sources and updating the wiki), Query (synthesizing answers with citations), and Lint (health-checking for contradictions and gaps). Indexing and logging (index.md, log.md) ensure the system is navigable and auditable.

## Cross-References
- [[Andrej_Karpathy|Andrej Karpathy]]
- [[Mnemonic_Light|Mnemonic Light]]
- [[Mnemonic_Hardcore|Mnemonic Hardcore]]
- [[Cross_Chat_Knowledge_Base|Cross-Chat Knowledge Base]]

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: Ingested Karpathy's 'LLM OS' gist, establishing the LLM Wiki as a foundational architectural pattern for Mnemonic51. Source: `raw/research/mm/2026-04-18-karpathy-llm-os.md`
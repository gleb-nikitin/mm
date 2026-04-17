---
name: query
description: Answer a user question by searching the local brain first, reading the most relevant wiki pages, and using raw evidence only when needed.
---

# Skill: Query

Use this when the user asks a factual or synthesis question that may already be covered by the brain.

## Intent Categories

1. **Entity Lookup**: Find specific facts about a person, place, or thing.
2. **Temporal Query**: "When did X happen?" or "How has Y evolved?"
3. **Conceptual Synthesis**: Connect multiple ideas or summarize a broad topic.

## Workflow

1. **Analyze Intent**: Determine if this is an entity, temporal, or conceptual query.
2. **Search & Read**:
   - Exact slug/alias hits first.
   - Relevant wiki pages by content.
   - Raw evidence only if needed for deeper detail.
3. **Synthesize Answer**:
   - Answer using ONLY the provided context from the brain.
   - If info is missing, state clearly what is known and what is missing.
4. **Cite Sources**:
   - **MANDATORY**: Every major claim must cite its source.
   - Format: `[[Page_Slug|Page Title]]` for wiki info, or `raw/filename.md` for raw evidence.

## Citation Rule
Do not make claims without a specific citation. If multiple pages support a claim, cite all relevant ones.

## Durable Synthesis
If you produce a high-value synthesis, the user may request to `--save` it. In that case, use `bun brain.ts page create` to save it as an `analysis` type page.

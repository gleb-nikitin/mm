# Karpathy's LLM OS (llm-wiki.md)

Source: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Most people's experience with LLMs and documents looks like RAG: you upload a collection of files, the LLM retrieves relevant chunks at query time, and generates an answer. This works, but the LLM is rediscovering knowledge from scratch on every question. There's no accumulation.

The idea here is different. Instead of just retrieving from raw documents at query time, the LLM incrementally builds and maintains a persistent wiki — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening or challenging the evolving synthesis. The knowledge is compiled once and then kept current, not re-derived on every query.

This is the key difference: the wiki is a persistent, compounding artifact. The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read. The wiki keeps getting richer with every source you add and every question you ask.

There are three layers:
1. **Raw sources** — immutable collection.
2. **The wiki** — directory of LLM-generated markdown files.
3. **The schema** — a document (e.g. CLAUDE.md) that tells the LLM how the wiki is structured and what workflows to follow.

Operations:
- **Ingest**: Reads source, discusses takeaways, writes summary, updates index/entities/log.
- **Query**: Search wiki, synthesize answer with citations. File good answers back into the wiki.
- **Lint**: Periodically health-check for contradictions, stale claims, orphans, gaps.

Indexing/Logging:
- **index.md**: Content-oriented catalog, organized by category.
- **log.md**: Chronological record of operations.

# Cross-Chat Knowledge Base

Source: https://github.com/g0rd33v/wizrag/blob/main/cross-chat-knowledge-base.md
Author: Eugene Gordeev

A pattern for persistent, cross-platform knowledge using URLs and markdown.

The core idea:
Instead of a complex RAG setup, you get a single URL. Paste it into any AI chat. The AI visits the URL, reads a markdown instruction page, and learns how to retrieve from your knowledge base, save new context back to it, and build a browsable wiki.

How it works:
1. **The documents**: Source material, chunked and indexed.
2. **The URL**: Access token and instruction manual (Skills as Markdown).
3. **The wiki**: Auto-generated, browsable markdown pages with contradictions flagged and a changelog.

The commands (via URL visits):
- **Ask**: Retrieval + grounded answer.
- **Save**: Write context back to the KB.
- **Validate**: Self-correction against ground truth.
- **Update wiki**: Topics clustering, cross-referencing, contradiction detection.
- **Lint wiki**: Health report.
- **Save to wiki**: File AI answers as new wiki pages.

Semantic dedup:
Before saving, check cosine distance (threshold 0.02) to prevent bloat from repeated info across chats.

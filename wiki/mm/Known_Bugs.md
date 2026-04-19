---
title: Known Bugs
slug: known-bugs
tags: [extracted]
type: analysis
status: active
created_at: 2026-04-20
updated_at: 2026-04-20
---

# Known Bugs

<!-- ENTRIES: append-only below this line -->
- **2026-04-20** [mm]: Stale search results or missing pages in `/search` if `index rebuild` isn't run after disk edits. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Pages not cited in `/query` if they lack embeddings; requires `embed` after `index rebuild`. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: Filtered search (`?source=X&project=Y`) returns nothing for raw entries because they are missing embeddings. Source: `raw/docs/mm/how-to-index.md`
- **2026-04-20** [mm]: `gemini -i` argument parsing error "Not enough arguments following: i" occurs if the prompt starts with dashes (`---`); fixed by using `-i="${prompt}"` syntax. Source: `event:8c4621a0-6dec-40b0-b83e-692d7fb4cb1d`

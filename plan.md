# Plan: The Brain

This project is a local-first, persistent knowledge base for AI agents. It is not "chat with files" and it is not a generic RAG demo. The goal is to build a compounding wiki: raw material goes in, the agent continuously synthesizes durable pages, and future queries read those pages before doing fresh research.

The design is informed by three patterns:

- Karpathy's LLM Wiki: raw sources + maintained wiki + schema-guided agent workflow.
- WizRAG's cross-chat knowledge base: writable memory, URL-as-tool, markdown-first surfaces.
- GBrain's "thin harness, fat skills": deterministic primitives in code, judgment in markdown procedures.

This rewrite assumes the current repo should become a real system, not a one-off prompt wrapped in a CLI.

## 1. Product Goal

Build a brain that lets an agent:

- ingest new material into `/raw/`
- synthesize and update canonical pages in `/wiki/`
- maintain an index, changelog, and timeline in `/meta/`
- answer questions by reading the brain first
- expose the same brain through CLI, MCP, and HTTP

The key outcome is compounding context: the same insight should not need to be rediscovered in every future session.

## 2. Design Principles

### 2.1 Markdown Is The Source Of Truth

- `/raw/` stores immutable source material
- `/wiki/` stores maintained, human-readable synthesis
- `/meta/` stores navigation, logs, schema, and operational state

SQLite is an index and job-state layer, not the canonical knowledge layer.

### 2.2 Thin Harness, Fat Skills

Code should do deterministic work:

- file IO
- indexing
- search
- link validation
- job scheduling
- provenance bookkeeping

The LLM should do judgment work:

- extract entities
- decide whether information is novel
- synthesize updates
- detect contradictions
- propose merges or splits

Do not bury agent behavior in inline string prompts inside TypeScript. The reusable workflow belongs in versioned markdown skill files and schema docs.

### 2.3 Brain-First Retrieval

Before the agent answers from memory or searches the web, it must:

1. read `meta/index.md` or query the local index
2. open the top relevant wiki pages
3. use raw sources only when wiki pages are missing, thin, stale, or contradictory

The brain is the first stop, not a sidecar.

### 2.4 Provenance Is Mandatory

Every synthesized claim in `/wiki/` must be traceable to one or more raw entries.

Minimum requirement:

- every wiki update stores source raw entry ids in SQLite
- every wiki page includes a `Sources` or `Evidence` section
- the system can answer "why is this page saying this?"

Without provenance, the brain will drift and become untrustworthy.

### 2.5 Canonical Page Identity

Every page needs:

- a canonical slug
- optional aliases
- stable wiki links

Display names may contain spaces or native scripts, but file naming and link resolution must be canonicalized. Broken links are not acceptable because they destroy navigation and maintenance.

## 3. Non-Goals For V1

These are explicitly out of scope for the first usable version:

- cloud hosting
- multi-user collaboration
- heavy graph databases
- vector infrastructure as the primary retrieval path
- autonomous cron ingestion of every possible source type
- broad multimodal ingestion beyond simple text-first workflows

Vector search may be added later if lexical + metadata search becomes insufficient. It is not the foundation.

## 4. System Architecture

### 4.1 Storage Layout

#### `/raw/`

Append-only sources:

- imported chat slices
- manual notes
- clips
- API saves
- future transcript imports

Each raw item gets:

- stable id
- title
- created_at
- source_type
- source_ref
- content hash
- body markdown

#### `/wiki/`

Maintained pages:

- people
- projects
- concepts
- places
- products
- summaries

Each wiki page gets:

- canonical slug
- title
- aliases
- tags
- created_at
- updated_at
- status: `stub | active | merged | archived`
- summary
- facts / narrative
- evidence / sources
- related pages

#### `/meta/`

Operational files:

- `index.md`: content-oriented catalog of the wiki
- `log.md`: append-only operation log
- `timeline.md`: chronological view across raw and wiki events
- `schema.md`: page conventions, linking rules, update policy
- `skills/`: markdown procedures for ingest, query, maintain, lint

### 4.2 SQLite Layer

SQLite is the deterministic engine behind the markdown brain.

Suggested tables:

- `raw_entries`
- `wiki_pages`
- `wiki_aliases`
- `wiki_links`
- `claims`
- `claim_sources`
- `jobs`
- `operations_log`
- `search_index` or FTS virtual tables

Use SQLite for:

- queueing unprocessed raw entries
- fast keyword search
- page lookup by slug or alias
- backlink tracking
- provenance joins
- maintenance jobs

### 4.3 Deterministic Commands

The core harness should provide small commands with predictable behavior:

- `brain add`
- `brain import-chat`
- `brain queue`
- `brain process`
- `brain search`
- `brain read`
- `brain page create`
- `brain page update`
- `brain index rebuild`
- `brain links check`
- `brain lint`
- `brain timeline rebuild`
- `brain log append`

These commands are what the LLM should call. The LLM should not be given vague "go edit files however you want" instructions as the primary operating model.

## 5. Agent Layer

The agent layer should be defined in markdown, not hidden in code.

### 5.1 Required Skill Files

Add a small skill set:

- `meta/skills/ingest.md`
- `meta/skills/query.md`
- `meta/skills/maintain.md`
- `meta/skills/lint.md`
- `meta/skills/import-chat.md`

Each skill should define:

- when to use it
- what files/tools to read first
- deterministic commands to call
- expected output shape
- quality checks before writing

### 5.2 Resolver / Schema

`meta/schema.md` should tell the agent:

- how page types are structured
- how links are written
- when to create a new page vs update an existing one
- how to cite sources
- how to handle contradictions
- how to record operations in `meta/log.md`

This is the equivalent of Karpathy's schema layer and GBrain's resolver mindset.

## 6. Core Workflows

### 6.1 Ingest Workflow

When new material arrives:

1. save immutable markdown to `/raw/`
2. compute hash and metadata
3. register a processing job in SQLite
4. find candidate pages by slug, alias, and search
5. let the agent decide:
   - update existing page
   - create new page
   - attach as evidence only
   - defer as low-signal
6. write page updates deterministically
7. record provenance
8. update `index.md`, `log.md`, `timeline.md`

### 6.2 Query Workflow

When the user asks a question:

1. search the local brain
2. open the top 3-5 relevant pages
3. if needed, open linked raw evidence
4. answer with citations to page names and, when relevant, raw entries
5. if the answer produced a durable artifact, optionally save it back into the wiki

### 6.3 Maintenance Workflow

Periodic maintenance should check:

- broken links
- orphan pages
- alias collisions
- stale pages with many new raw mentions
- contradictory claims across pages
- pages with weak or missing evidence
- pages that should be merged or split

Maintenance should produce a report first. Destructive changes should be explicit.

## 7. Retrieval Strategy

### V1

Use hybrid local retrieval without embeddings:

- SQLite FTS / keyword search
- exact slug and alias lookup
- backlink count
- recency weighting
- page type weighting

This is enough for a moderate-scale wiki and matches Karpathy's "index first" idea better than premature vector infra.

### V2

Add optional embeddings only after lexical retrieval is insufficient.

If added:

- embeddings index raw chunks and page summaries
- ranking uses reciprocal rank fusion or a simple weighted merge
- vector retrieval supplements, not replaces, page-level navigation

## 8. External Interfaces

### 8.1 CLI

CLI is the primary operating surface.

It must be reliable without an LLM attached.

### 8.2 MCP

MCP should expose deterministic brain operations:

- search pages
- read page
- add raw entry
- queue processing
- get backlinks
- list stale pages

MCP should not just dump raw SQL rows. It should expose brain-native operations.

### 8.3 HTTP / URL-As-Tool

Keep this small and markdown-first.

Useful endpoints:

- `GET /` returns instructions
- `GET /add?title=...&content=...`
- `GET /search?q=...`
- `GET /page/:slug`
- `GET /log`
- `GET /timeline`
- `GET /lint`

If this surface is meant for browser-capable LLMs, responses should prefer markdown over JSON.

Do not over-rotate into a full web app before the core brain loop is stable.

## 9. Data Model For Wiki Pages

Recommended page template:

```md
---
title: Example Page
slug: example-page
aliases: [Example, Ex]
tags: [concept]
status: active
created_at: 2026-04-17
updated_at: 2026-04-17
source_count: 3
---

# Example Page

## Summary

Short synthesized description.

## Key Facts

- Fact 1
- Fact 2

## Evidence

- 2026-04-17: Derived from raw/...
- 2026-04-18: Updated from raw/...

## Related

- [[Other Page]]
```

This is simple enough for humans and structured enough for agents.

## 10. Implementation Roadmap

### Phase 0: Reset The Spine

Goal: make the current repo coherent.

- define canonical page slug rules
- create `meta/schema.md`
- create `meta/skills/*.md`
- normalize TypeScript/Bun config so the repo actually typechecks
- split raw entry storage from wiki page indexing
- replace inline prompt strings with skill-driven flows

Exit criteria:

- project builds cleanly
- one deterministic command can create/read/update a page
- one skill can process a raw entry using those commands

### Phase 1: Deterministic Brain Ops

Goal: build the reliable harness.

- migrate from single `entries` table to real tables
- add FTS search
- add page registry with aliases
- add backlinks index
- add operation log table
- rebuild `meta/index.md` from SQLite
- rebuild `meta/timeline.md` from SQLite

Exit criteria:

- `brain search` returns ranked page hits
- `brain read <slug>` works
- `brain links check` finds broken links
- `brain index rebuild` is deterministic

### Phase 2: Ingest And Synthesis

Goal: process raw items into a compounding wiki.

- implement raw queue
- implement candidate page lookup
- implement create-vs-update decision workflow
- store provenance for every update
- write log entries automatically
- add duplicate detection based on content hash and candidate similarity

Exit criteria:

- importing 20 raw entries produces stable wiki updates
- rerunning ingest is idempotent
- every wiki fact can be traced to sources

### Phase 3: Query And Maintenance

Goal: make the brain useful in live work.

- implement brain-first query workflow
- return page citations in answers
- build lint report for contradictions, orphans, and stale pages
- add page promotion rules: stub -> active after repeated mentions

Exit criteria:

- the agent can answer a question from prior chat history without manual context
- lint report catches real broken links and stale pages

### Phase 4: External Surfaces

Goal: expose the stable core to agents and tools.

- improve MCP tools around brain-native operations
- add markdown-first HTTP endpoints
- add import adapters for chat history and simple transcripts

Exit criteria:

- Claude/Codex/Cursor can read and write through the MCP server
- browser-capable LLMs can use the HTTP surface

### Phase 5: Optional Semantic Retrieval

Goal: improve retrieval only if needed.

- add embeddings for raw chunks and page summaries
- fuse lexical + semantic ranking
- keep provenance and page drill-down as the primary path

Exit criteria:

- measurable query quality improvement on a fixed eval set

## 11. Success Metrics

### Functional

- the agent answers using the brain before using the web
- raw imports produce page updates, not just raw accumulation
- broken links trend to zero
- index, log, and timeline stay current automatically

### Quality

- every wiki page has a summary, evidence, and related links
- every durable claim is traceable to at least one raw source
- rerunning ingest does not duplicate facts

### Operational

- local search is fast enough for interactive use
- ingest and maintenance can run unattended
- the repo remains understandable as plain markdown plus a small deterministic core

## 12. Immediate Next Tasks

In order:

1. create `meta/schema.md`
2. create `meta/skills/ingest.md`, `query.md`, `maintain.md`, `lint.md`
3. redesign SQLite schema away from the single `entries` table
4. implement canonical slug generation and alias resolution
5. implement deterministic page registry + index rebuild
6. implement link checker and fix existing broken links
7. rework ingest so the agent updates pages through deterministic commands

## 13. What To Avoid

- do not depend on one model CLI being able to freestyle file maintenance
- do not make vector search the first milestone
- do not store important facts only in chat or only in SQLite
- do not let aliases and filenames drift apart
- do not let wiki pages exist without provenance
- do not expose generic tools where brain-native operations should exist

## 14. Definition Of Done For V1

V1 is done when:

- a user can add or import new material
- the brain turns it into maintained wiki pages
- the agent can answer by reading those pages first
- the system can explain where each fact came from
- index, log, timeline, and links remain healthy without manual cleanup

That is the minimum viable compounding brain.

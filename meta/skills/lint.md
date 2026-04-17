---
name: lint
description: Audit the brain for structural problems such as broken links, duplicate pages, contradictory claims, weak evidence, and missing navigation.
---

# Skill: Lint

Use this when auditing the health of the brain.

## Goal

Produce a clear report of what is wrong, what is risky, and what should be fixed next.

## Check For

- broken wiki links
- alias collisions
- duplicate pages for the same subject
- pages with no evidence
- pages with no summary
- contradictions across related pages
- orphan pages with no inbound or outbound links
- pages whose filename and visible links do not match the canonical rule

## Workflow

1. Read `meta/schema.md`.
2. Scan `/wiki/` for structural issues.
3. Group findings by severity:
   - correctness
   - navigation
   - provenance
   - formatting
4. Report concrete file names and examples.
5. If asked to fix issues, do so in a second pass.

## Output Format

Prefer a short report with:

- finding
- affected files
- why it matters
- recommended fix

## Do Not

- silently rewrite many pages during an audit-only pass
- report vague style opinions as if they were correctness problems


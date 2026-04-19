const fs = require('fs');
const path = require('path');

function updatePage(slug, summary, timelineBullet) {
    const filePath = path.join('wiki', `${slug}.md`);
    if (!fs.existsSync(filePath)) {
        console.error(`File ${filePath} not found`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');

    // Bump mentions and updated_at
    content = content.replace(/mentions: (\d+)/, (match, p1) => `mentions: ${parseInt(p1) + 1}`);
    content = content.replace(/updated_at: '.*'/, `updated_at: '${new Date().toISOString()}'`);

    // Update Summary
    content = content.replace(/(## Summary\n)([\s\S]*?)(?=\n## Cross-References|\n---)/, `$1${summary}\n`);

    // Append timeline bullet
    if (timelineBullet) {
        content += `\n- **2026-04-18**: ${timelineBullet} Source: \`raw/claude/mm/2026-04-18T13-17-59-097Z.md\`\n`;
    }

    fs.writeFileSync(filePath, content);
    console.log(`Updated ${slug}`);
}

function createPage(slug, title, summary, timelineBullet, type='entity') {
    const filePath = path.join('wiki', `${slug}.md`);
    const dateStr = new Date().toISOString();
    const content = `---
title: ${title}
slug: ${slug}
aliases: []
tags: []
type: ${type}
confidence: 0.8
mentions: 1
tier: 2
status: active
created_at: '${dateStr}'
updated_at: '${dateStr}'
source_count: 1
---

# ${title}

## Summary
${summary}

## Cross-References

---
<!-- TIMELINE: append-only below this line -->

- **2026-04-18**: ${timelineBullet} Source: \`raw/claude/mm/2026-04-18T13-17-59-097Z.md\`
`;
    fs.writeFileSync(filePath, content);
    console.log(`Created ${slug}`);
}

// Updates
updatePage('Mnemonic_Light', 
  "Mnemonic Light is the TypeScript/Bun-based track of Mnemonic51, optimized for rapid iteration and packaged as an ac plugin (Holo app). It acts as the primary track where the 'skills as product' methodology is validated before any downstream Rust migration. It follows a structured 7-step development roadmap (Tests, Skills, Refactor, Hygiene, Retrieval, Polish, Hardcore).", 
  "Clarified Mnemonic Light as the TS/Bun track where the 'skills as product' methodology is proven before downstream migration."
);

updatePage('Mnemonic_Hardcore', 
  "Mnemonic Hardcore is the high-performance Rust track of Mnemonic51, conceived as an assembly of the ac Rust + Tauri shell and the tabularium storage substrate. It is formally deferred as a downstream milestone until the skills-based methodology is proven in Mnemonic Light.", 
  "Deferred Mnemonic Hardcore (Rust/Tabularium) until the skills methodology is fully proven in the Light track, establishing it as a downstream assembly."
);

updatePage('Mnemonic_UI', 
  "The Mnemonic UI is a single-page web interface built with Alpine.js and styled with an Aurora-inspired dark glassmorphism theme. It serves as a Holo app/ac plugin component for the Mnemonic Light track. The backend utilizes asynchronous 'Bun.spawn' for Gemini synthesis to ensure a responsive, non-blocking experience during query execution.", 
  "Added debounced search, async Bun.spawn execution for Gemini synthesis, and fixed idle timeouts for stable query delivery."
);

updatePage('Mnemonic_Ingestion_Pipeline', 
  "The Mnemonic Ingestion Pipeline manages a data lifecycle from raw input to vector search. It implements a two-level filesystem layout (\`raw/<source_type>/<project>/\`) backed by git for tracking batch identities, alongside a declarative orchestration layer via \`config.toml\` for scheduled LLM processing.", 
  "Implemented Schema v4 with \`source_type\` and \`project\` dimensions for scoped retrieval, and defined a two-level filesystem layout. Designed a declarative orchestration layer via \`config.toml\`."
);

updatePage('Claude_Session_Importer', 
  "A TypeScript script (scripts/import-claude.ts) that normalizes and ingests Claude session transcripts into the raw/ repository. It natively parses JSONL logs, filters by project/turns/date, deduplicates via content hash, and automatically tags ingested entries with appropriate \`source_type\` and \`project\` dimensions without relying on external python tools.", 
  "Developed \`scripts/import-claude.ts\` to natively import and deduplicate Claude sessions with project-specific tagging, replacing external python dependencies."
);

updatePage('Mnemonic_Derivation_Skills', 
  "Derivation Skills form the active product layer of Mnemonic51, converting it into a project-management primitive. The system relies on families of skills—such as 'derive-todos' (actions), 'derive-bugs' (defects), 'derive-decisions' (architectural choices), and 'derive-friction' (pain points)—to autonomously extract and maintain project state directly from conversations.", 
  "Reframed Mnemonic51's core product around the skills library, establishing the \`derive-*\` family as the primary mechanism to transform conversational insights into actionable project management artifacts."
);

updatePage('Mnemonic51', 
  "Mnemonic51 (short name mm) is fundamentally a project-management primitive that observes and evolves itself by extracting decisions, friction, and actions from raw conversational input. It relies on a rich LLM 'skills library' (e.g., derive-todos) over a raw markdown corpus, proving the methodology out in a rapid TS/Bun environment (Mnemonic Light) before eventually transitioning to a high-performance assembly (Mnemonic Hardcore).", 
  "Reframed Mnemonic51 fundamentally as a project-management primitive that observes and evolves itself via its skills library, transitioning from a mere memory engine."
);

updatePage('Tabularium', 
  "Tabularium is an Apache-2.0 Rust project comprising library, server, and CLI components. It provides a cohesive sub-stack involving markdown docs, SQLite, Tantivy search, and MCP support. It has been selected as the primary storage and search substrate for Mnemonic Hardcore.", 
  "Identified Tabularium as the ideal Rust sub-stack for Mnemonic Hardcore, providing markdown docs, SQLite, Tantivy search, and MCP out of the box."
);

updatePage('GBrain', 
  "GBrain is a personal memory engine for AI agents developed by Garry Tan. Its architecture, specifically its use of intent classification branching, multi-query expansion, tiered auto-promotion, and eval harnesses, provided pivotal design inspiration for optimizing Mnemonic51's retrieval and testing layers.", 
  "Analyzed GBrain architecture, extracting high-signal patterns for Mnemonic51 including intent classification branching, multi-query expansion, and an eval harness."
);

updatePage('Mnemonic_Synthesis_Briefing', 
  "Mnemonic Synthesis Briefing is an optimization protocol that utilizes persistent LLM sessions pre-loaded with stable contextual preambles (briefings) to vastly reduce query latency. This pattern prevents re-injecting large systemic context (like schemas) per-query, enabling both fast interactive retrieval and batched ingestion passes.", 
  "Refined synthesis briefing patterns to support batched ingestion and reduce token bloat by utilizing pre-loaded persistent LLM sessions."
);

createPage('Mnemonic_Orchestration', 
  'Mnemonic Orchestration', 
  "Mnemonic Orchestration constitutes the declarative scheduling layer for automated LLM batch operations in Mnemonic51. It abandons manual crontabs in favor of a \`config.toml\` specification that defines import triggers, LLM batch execution, and ingestion pipelines, making project evolution fully observable and LLM-editable.", 
  "Designed a declarative orchestration layer via \`config.toml\` to schedule data ingestion and batch LLM operations, replacing manual crontabs.",
  "concept"
);

// Add log to meta/log.md
const logEntry = "\n- 2026-04-18: Ingest — 1 created, 10 updated from `raw/claude/mm/2026-04-18T13-17-59-097Z.md`. Created: [[Mnemonic_Orchestration]]. Updated: [[Mnemonic_Light]], [[Mnemonic_Hardcore]], [[Mnemonic_UI]], [[Mnemonic_Ingestion_Pipeline]], [[Claude_Session_Importer]], [[Mnemonic_Derivation_Skills]], [[Mnemonic51]], [[Tabularium]], [[GBrain]], [[Mnemonic_Synthesis_Briefing]]";
fs.appendFileSync('meta/log.md', logEntry);
console.log('Appended to meta/log.md');


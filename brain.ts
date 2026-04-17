import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';
import { spawnSync, execFileSync } from 'child_process';
import * as os from 'os';
import yaml from 'js-yaml';

const program = new Command();
const dbFile = path.join('meta', 'brain.db');

// Initialize Database
const db = new Database(dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

function cosine_sim(a: Buffer | null | undefined, b: Buffer | null | undefined): number {
  if (!a || !b) return 0;
  const va = new Float32Array(a.buffer, a.byteOffset, a.length / 4);
  const vb = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i]; na += va[i] * va[i]; nb += vb[i] * vb[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function initDb() {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let currentVersion = row ? row.version : 0;

  if (currentVersion < 1) {
    db.run(`CREATE TABLE IF NOT EXISTS raw_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT NOT NULL, source_path TEXT UNIQUE, hash TEXT, processed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    db.run(`CREATE TABLE IF NOT EXISTS wiki_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, tags TEXT, status TEXT, source_count INTEGER DEFAULT 0, summary TEXT, created_at DATETIME, updated_at DATETIME);`);
    db.run(`CREATE TABLE IF NOT EXISTS wiki_aliases (alias TEXT PRIMARY KEY, slug TEXT, FOREIGN KEY(slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
    db.run(`CREATE TABLE IF NOT EXISTS wiki_links (source_slug TEXT, target_slug TEXT, PRIMARY KEY (source_slug, target_slug), FOREIGN KEY(source_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE, FOREIGN KEY(target_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
    db.run(`CREATE TABLE IF NOT EXISTS operations_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, operation TEXT, details TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS claims (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_slug TEXT NOT NULL, claim_text TEXT NOT NULL, FOREIGN KEY(wiki_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
    db.run(`CREATE TABLE IF NOT EXISTS claim_sources (claim_id INTEGER NOT NULL, raw_id INTEGER NOT NULL, PRIMARY KEY (claim_id, raw_id), FOREIGN KEY(claim_id) REFERENCES claims(id) ON DELETE CASCADE, FOREIGN KEY(raw_id) REFERENCES raw_entries(id) ON DELETE CASCADE);`);
    try { db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(slug, title, content, tags);`); } catch (e) {}
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (1)');
    currentVersion = 1;
  }

  if (currentVersion < 2) {
    try { db.run('ALTER TABLE wiki_pages ADD COLUMN type TEXT;'); db.run('ALTER TABLE wiki_pages ADD COLUMN confidence REAL DEFAULT 0.5;'); db.run('ALTER TABLE wiki_pages ADD COLUMN mentions INTEGER DEFAULT 1;'); db.run('ALTER TABLE wiki_pages ADD COLUMN tier INTEGER DEFAULT 3;'); } catch (e) {}
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (2)');
    currentVersion = 2;
  }

  if (currentVersion < 3) {
    console.log('🚀 Migrating to schema version 3: Adding chunks table for semantic search...');
    db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_type TEXT NOT NULL CHECK(owner_type IN ('wiki', 'raw')),
        page_slug TEXT,
        raw_id INTEGER,
        chunk_type TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(page_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE,
        FOREIGN KEY(raw_id) REFERENCES raw_entries(id) ON DELETE CASCADE,
        CHECK (
          (owner_type = 'wiki' AND page_slug IS NOT NULL AND raw_id IS NULL) OR
          (owner_type = 'raw' AND raw_id IS NOT NULL AND page_slug IS NULL)
        )
      );
    `);
    db.run('INSERT OR REPLACE INTO schema_version (version) VALUES (3)');
    currentVersion = 3;
  }
}
initDb();

// --- Internal Logic ---

function slugify(text: string): string {
  return text.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]+/gu, '').toLowerCase();
}

function getHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function internalRecordClaim(slug: string, claim: string, raw_id: number) {
  const pageExists = db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug);
  if (!pageExists) throw new Error(`Page not found: ${slug}`);
  const rawExists = db.prepare('SELECT 1 FROM raw_entries WHERE id = ?').get(raw_id);
  if (!rawExists) throw new Error(`Raw entry not found: ${raw_id}`);
  const res = db.prepare('INSERT INTO claims (wiki_slug, claim_text) VALUES (?, ?)').run(slug, claim);
  const claim_id = res.lastInsertRowid;
  db.prepare('INSERT INTO claim_sources (claim_id, raw_id) VALUES (?, ?)').run(claim_id, raw_id);
  db.prepare(`UPDATE wiki_pages SET source_count = (SELECT COUNT(DISTINCT raw_id) FROM claim_sources WHERE claim_id IN (SELECT id FROM claims WHERE wiki_slug = ?)) WHERE slug = ?`).run(slug, slug);
}

function internalRebuildIndex() {
  console.log('🏗️ Syncing index...');
  const rawFiles = fs.readdirSync('raw').filter(f => f.endsWith('.md'));
  const foundRawPaths = new Set<string>();
  for (const file of rawFiles) {
    const filePath = path.join('raw', file);
    foundRawPaths.add(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const titleMatch = content.match(/^# (.*)/);
    const title = titleMatch ? titleMatch[1] : file;
    const hash = getHash(content);
    db.prepare(`INSERT INTO raw_entries (title, content, source_path, hash, processed) VALUES (?, ?, ?, ?, 1) ON CONFLICT(source_path) DO UPDATE SET title = excluded.title, content = excluded.content, hash = excluded.hash`).run(title, content, filePath, hash);
  }
  const allRaw = db.prepare('SELECT id, source_path FROM raw_entries').all() as any[];
  for (const r of allRaw) if (!foundRawPaths.has(r.source_path)) db.prepare('DELETE FROM raw_entries WHERE id = ?').run(r.id);

  const wikiFiles = fs.readdirSync('wiki').filter(f => f.endsWith('.md'));
  const foundSlugs = new Set<string>();
  const allLinks: { source: string, target: string }[] = [];
  db.run('DELETE FROM wiki_aliases'); db.run('DELETE FROM wiki_links'); db.run('DELETE FROM search_index');
  for (const file of wikiFiles) {
    const slug = file.replace('.md', '');
    foundSlugs.add(slug);
    const fileContent = fs.readFileSync(path.join('wiki', file), 'utf-8');
    try {
      const parts = fileContent.split('---');
      if (parts.length >= 3) {
        const frontmatter = yaml.load(parts[1]) as any;
        const body = parts.slice(2).join('---');
        const summaryMatch = body.match(/## Summary\n\n(.*?)\n/s);
        const summary = summaryMatch ? summaryMatch[1].trim() : '';
        db.prepare(`INSERT INTO wiki_pages (slug, title, tags, status, source_count, summary, type, confidence, mentions, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tags = excluded.tags, status = excluded.status, source_count = excluded.source_count, summary = excluded.summary, type = excluded.type, confidence = excluded.confidence, mentions = excluded.mentions, tier = excluded.tier, updated_at = excluded.updated_at`).run(slug, String(frontmatter.title || slug), JSON.stringify(frontmatter.tags || []), String(frontmatter.status || 'active'), Number(frontmatter.source_count || 0), summary, String(frontmatter.type || 'concept'), Number(frontmatter.confidence || 0.5), Number(frontmatter.mentions || 1), Number(frontmatter.tier || 3), String(frontmatter.created_at || new Date().toISOString()), String(frontmatter.updated_at || new Date().toISOString()));
        db.prepare('INSERT INTO search_index (slug, title, content, tags) VALUES (?, ?, ?, ?)').run(slug, frontmatter.title || slug, fileContent, (frontmatter.tags || []).join(', '));
        if (frontmatter.aliases) for (const alias of frontmatter.aliases) if (alias) db.prepare('INSERT OR IGNORE INTO wiki_aliases (alias, slug) VALUES (?, ?)').run(alias, slug);
        const links = body.match(/\[\[(.*?)\]\]/g);
        if (links) for (const link of links) { const target = link.slice(2, -2).split('|')[0]; allLinks.push({ source: slug, target }); }
      }
    } catch (e) { console.error(`❌ Parse error ${file}:`, e); }
  }
  const allPages = db.prepare('SELECT slug FROM wiki_pages').all() as any[];
  for (const p of allPages) if (!foundSlugs.has(p.slug)) db.prepare('DELETE FROM wiki_pages WHERE slug = ?').run(p.slug);
  for (const { source, target } of allLinks) { try { db.prepare('INSERT OR IGNORE INTO wiki_links (source_slug, target_slug) VALUES (?, ?)').run(source, target); } catch (e) {} }
}

function internalRebuildMarkdownIndex() {
  const pages = db.prepare('SELECT slug, title, tags, summary, type, confidence, tier FROM wiki_pages ORDER BY title ASC').all() as any[];
  let content = "# Index\n\n";
  const byTag: Record<string, any[]> = {};
  for (const p of pages) {
    const tags = JSON.parse(p.tags);
    const tag = tags[0] || 'uncategorized';
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(p);
  }
  for (const [tag, pgs] of Object.entries(byTag)) {
    content += `## ${tag.charAt(0).toUpperCase() + tag.slice(1)}\n\n`;
    for (const p of pgs) content += `- [[${p.slug}|${p.title}]]: ${p.summary || 'No summary.'} [${p.type}, ${p.confidence}, T${p.tier}]\n`;
    content += "\n";
  }
  fs.writeFileSync(path.join('meta', 'index.md'), content);
}

function internalRebuildTimeline() {
  const rawEntries = db.prepare('SELECT title, created_at FROM raw_entries ORDER BY created_at DESC').all() as any[];
  let timelineContent = "# Brain Timeline\n\n"; let currentMonth = "";
  for (const entry of rawEntries) {
    const date = new Date(entry.created_at); const month = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    if (month !== currentMonth) { currentMonth = month; timelineContent += `\n## ${currentMonth}\n\n`; }
    timelineContent += `- **${date.toLocaleDateString()}**: [RAW] ${entry.title}\n`;
  }
  fs.writeFileSync(path.join('meta', 'timeline.md'), timelineContent);
}

function runGemini(prompt: string, yolo: boolean = false) {
  const args = yolo ? ['--yolo', `-p=${prompt}`] : [`-p=${prompt}`];
  try {
    const res = execFileSync('gemini', args, { encoding: 'utf-8' });
    process.stdout.write(res);
    return { status: 0, stdout: res };
  } catch (e: any) {
    return { status: (e as any).status || 1, stderr: e.message };
  }
}

// --- Semantic Search Logic ---

async function embed(text: string): Promise<Float32Array | null> {
  try {
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
    });
    if (!res.ok) { console.error('❌ Ollama error:', res.status); return null; }
    const data = await res.json() as { embedding: number[] };
    return new Float32Array(data.embedding);
  } catch (e) {
    // Silent fail if Ollama is not running, gracefully fallback
    return null;
  }
}

function chunkText(text: string, maxTokens = 400, overlapFraction = 0.2): string[] {
  // Approximate chunking by words
  const words = text.split(/(\s+)/); // keep whitespace for reassembly
  const chunks: string[] = [];
  let currentChunkWords: string[] = [];
  let currentWordCount = 0;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentChunkWords.push(word);
    if (word.trim().length > 0) currentWordCount++;
    
    if (currentWordCount >= maxTokens) {
      chunks.push(currentChunkWords.join(''));
      
      // Calculate overlap back-tracking
      const overlapWordsCount = Math.floor(maxTokens * overlapFraction);
      let backtrackWords = 0;
      let backtrackIndex = currentChunkWords.length - 1;
      
      while (backtrackIndex >= 0 && backtrackWords < overlapWordsCount) {
        if (currentChunkWords[backtrackIndex].trim().length > 0) backtrackWords++;
        backtrackIndex--;
      }
      
      currentChunkWords = currentChunkWords.slice(backtrackIndex + 1);
      currentWordCount = overlapWordsCount;
    }
  }
  
  if (currentWordCount > 0) {
    chunks.push(currentChunkWords.join(''));
  }
  
  return chunks;
}

type SearchResult = {
  slug: string | null;
  title: string;
  score: number;
  snippet: string;
  source: 'wiki' | 'raw';
};

async function hybridSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);
  
  // 1. FTS5 BM25 (Wiki only)
  const ftsResults = db.prepare(`
    SELECT slug, title, content, bm25(search_index) as rank
    FROM search_index 
    WHERE search_index MATCH ? 
    ORDER BY rank LIMIT 50
  `).all(`"${query}"`) as any[];

  // 2. Vector Cosine (Wiki + Raw)
  let vectorResults: any[] = [];
  if (queryEmbedding) {
    const queryBuffer = Buffer.from(queryEmbedding.buffer);
    const chunks = db.prepare(`
      SELECT c.owner_type, c.page_slug, c.raw_id, c.chunk_type, c.text, c.embedding,
             COALESCE(w.title, r.title) as title
      FROM chunks c
      LEFT JOIN wiki_pages w ON c.page_slug = w.slug
      LEFT JOIN raw_entries r ON c.raw_id = r.id
      WHERE c.embedding IS NOT NULL
    `).all() as any[];

    vectorResults = chunks.map(c => {
      let cos_score = cosine_sim(c.embedding, queryBuffer);
      if (c.chunk_type === 'wiki_truth') cos_score += 0.1;
      return { ...c, cos_score };
    });

    vectorResults.sort((a, b) => b.cos_score - a.cos_score);
    vectorResults = vectorResults.slice(0, 50);
  }

  // 3. RRF Fusion
  const rrfScores = new Map<string, SearchResult>();

  // Helper to gen unique ID for fusion grouping
  const getUid = (type: string, slug: string | null, raw_id: number | null) => `${type}:${slug || raw_id}`;

  ftsResults.forEach((r, index) => {
    const uid = getUid('wiki', r.slug, null);
    const score = 1 / (60 + index + 1);
    if (!rrfScores.has(uid)) {
      rrfScores.set(uid, { slug: r.slug, title: r.title, score: 0, snippet: r.content.substring(0, 200) + '...', source: 'wiki' });
    }
    rrfScores.get(uid)!.score += score;
  });

  vectorResults.forEach((r, index) => {
    const uid = getUid(r.owner_type, r.page_slug, r.raw_id);
    const score = 1 / (60 + index + 1);
    if (!rrfScores.has(uid)) {
      rrfScores.set(uid, { 
        slug: r.page_slug, 
        title: r.title, 
        score: 0, 
        snippet: r.text, 
        source: r.owner_type as 'wiki' | 'raw' 
      });
    }
    const current = rrfScores.get(uid)!;
    current.score += score;
    // Keep best snippet (highest individual vector rank usually means best snippet)
    if (index === 0 || current.snippet.length > 300) { 
       current.snippet = r.text; 
    }
  });

  let fused = Array.from(rrfScores.values());
  fused.sort((a, b) => {
    if (Math.abs(b.score - a.score) < 0.001) {
      // Tie breaker: wiki > raw
      if (a.source === 'wiki' && b.source === 'raw') return -1;
      if (b.source === 'wiki' && a.source === 'raw') return 1;
    }
    return b.score - a.score;
  });

  return fused.slice(0, limit);
}

async function semanticDedupCheck(content: string): Promise<void> {
  const queryEmbedding = await embed(content);
  if (!queryEmbedding) return;
  
  const queryBuffer = Buffer.from(queryEmbedding.buffer);
  const chunks = db.prepare(`
    SELECT c.owner_type, c.page_slug, c.raw_id, c.embedding, COALESCE(w.title, r.title) as title
    FROM chunks c
    LEFT JOIN wiki_pages w ON c.page_slug = w.slug
    LEFT JOIN raw_entries r ON c.raw_id = r.id
    WHERE c.embedding IS NOT NULL
  `).all() as any[];

  let topMatch: any = null;
  let maxScore = -1;

  for (const c of chunks) {
    const score = cosine_sim(c.embedding, queryBuffer);
    if (score > maxScore) {
      maxScore = score;
      topMatch = { ...c, cos_score: score };
    }
  }

  if (topMatch && topMatch.cos_score > 0.98) {
    const target = topMatch.owner_type === 'wiki' ? `[[${topMatch.page_slug}]]` : `Raw ID ${topMatch.raw_id}`;
    console.warn(`⚠️ Very similar to ${target} (similarity: ${topMatch.cos_score.toFixed(2)})`);
  }
}

// --- CLI Definitions ---

program.name('brain').version('0.6.0');

program.command('add').argument('<content>', 'Raw content').option('-t, --title <title>', 'Title').action(async (content, options) => {
  await semanticDedupCheck(content);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join('raw', `${timestamp}.md`);
  const title = options.title || `Entry ${timestamp}`;
  const hash = getHash(content);
  fs.writeFileSync(filePath, `# ${title}\n\nAdded: ${new Date().toLocaleString()}\n\n---\n\n${content}`);
  try {
    db.prepare('INSERT INTO raw_entries (title, content, source_path, hash) VALUES (?, ?, ?, ?)').run(title, content, filePath, hash);
    console.log(`✅ Saved ${filePath}`);
  } catch (e) { console.log(`⚠️ Exists.`); }
});

program.command('save').argument('<insight>', 'Freeform insight').option('-t, --title <title>', 'Title').action(async (insight, options) => {
  await semanticDedupCheck(insight);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join('raw', `${timestamp}-save.md`);
  const title = options.title || `Insight ${timestamp}`;
  const hash = getHash(insight);
  fs.writeFileSync(filePath, `# ${title}\n\nSaved Insight: ${new Date().toLocaleString()}\n\n---\n\n${insight}`);
  try {
    db.prepare('INSERT INTO raw_entries (title, content, source_path, hash) VALUES (?, ?, ?, ?)').run(title, insight, filePath, hash);
    console.log(`✅ Saved ${filePath}`);
    const results = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ? LIMIT 3').all(`"${insight}"`) as any[];
    if (results.length > 0) { console.log('\nSuggested pages to process into:'); results.forEach(r => console.log(`- [[${r.slug}|${r.title}]]`)); }
  } catch (e) { console.log(`⚠️ Exists.`); }
});

program.command('queue').action(() => {
  const unprocessed = db.prepare('SELECT id, title, created_at FROM raw_entries WHERE processed = 0').all();
  if (unprocessed.length === 0) console.log('✨ Empty.'); else console.table(unprocessed);
});

program.command('search').argument('<query>', 'Search term').action(async (query) => {
  console.log(`🔍 Searching for: "${query}"...`);
  
  // Quick check if embeddings exist
  const hasEmbeddings = (db.prepare('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL').get() as any).count > 0;
  
  if (hasEmbeddings) {
    const results = await hybridSearch(query);
    if (results.length > 0) {
      console.log('\n--- Hybrid Search Results ---');
      results.forEach(r => console.log(`[${r.source.toUpperCase()}] ${r.slug ? `[[${r.slug}|${r.title}]]` : r.title} (score: ${r.score.toFixed(3)})`));
    } else console.log('No matches.');
  } else {
    // Fallback FTS5
    const results = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ?').all(`"${query}"`) as any[];
    if (results.length > 0) {
      console.log('\n--- FTS Search Results ---');
      results.forEach(r => console.log(`[[${r.slug}|${r.title}]]`));
    } else console.log('No matches.');
  }
});

program.command('read').argument('<slug>', 'Slug').action((slug) => {
  const filePath = path.join('wiki', `${slug}.md`);
  if (fs.existsSync(filePath)) console.log(fs.readFileSync(filePath, 'utf-8')); else console.error(`❌ 404: ${slug}`);
});

program.command('query').argument('<question>', 'The question').option('--save', 'Save as analysis page').action(async (question, options) => {
  console.log(`🧠 Querying: "${question}"...`);
  
  const hasEmbeddings = (db.prepare('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL').get() as any).count > 0;
  let context = "";

  if (hasEmbeddings) {
    const results = await hybridSearch(question, 10);
    const wikiHits = results.filter(r => r.source === 'wiki');
    const rawHits = results.filter(r => r.source === 'raw');

    if (wikiHits.length > 0) {
      context += "## RELEVANT WIKI PAGES\n\n";
      for (let i = 0; i < Math.min(wikiHits.length, 3); i++) {
        const res = wikiHits[i];
        if (res.slug) {
          const body = fs.readFileSync(path.join('wiki', `${res.slug}.md`), 'utf-8');
          context += `### [[${res.slug}|${res.title}]]\n${body}\n---\n`;
        }
      }
      if (wikiHits.length > 3) {
        context += "### OTHER POTENTIAL MATCHES\n";
        for (let i = 3; i < wikiHits.length; i++) {
           if (wikiHits[i].slug) context += `- [[${wikiHits[i].slug}|${wikiHits[i].title}]]\n`;
        }
      }
    }

    if (rawHits.length > 0) {
      context += "\n## RAW EVIDENCE\n\n";
      for (let i = 0; i < Math.min(rawHits.length, 5); i++) {
        context += `### ${rawHits[i].title}\n${rawHits[i].snippet}\n---\n`;
      }
    }
  } else {
    // Fallback logic
    const exactHits = db.prepare('SELECT slug, title, summary FROM wiki_pages WHERE slug = ? OR slug IN (SELECT slug FROM wiki_aliases WHERE alias = ?)').all(question, question) as any[];
    const searchResults = db.prepare('SELECT slug, title, summary FROM wiki_pages WHERE slug IN (SELECT slug FROM search_index WHERE search_index MATCH ?) LIMIT 10').all(`"${question}"`) as any[];
    const uniqueResults = new Map();
    [...exactHits, ...searchResults].forEach(r => { if (!uniqueResults.has(r.slug)) uniqueResults.set(r.slug, r); });
    const finalResults = Array.from(uniqueResults.values());
    if (finalResults.length > 0) {
      context = "## RELEVANT WIKI PAGES\n\n";
      for (let i = 0; i < Math.min(finalResults.length, 3); i++) {
        const res = finalResults[i];
        context += `### [[${res.slug}|${res.title}]]\n${fs.readFileSync(path.join('wiki', `${res.slug}.md`), 'utf-8')}\n---\n`;
      }
    } else {
      context = "No direct wiki matches. Searching raw entries...\n";
      const rawResults = db.prepare('SELECT id, title, content FROM raw_entries WHERE title LIKE ? OR content LIKE ? LIMIT 5').all(`%${question}%`, `%${question}%`) as any[];
      if (rawResults.length > 0) {
        context += "## RAW EVIDENCE\n\n";
        for (const res of rawResults) context += `### ${res.title} (ID: ${res.id})\n${res.content}\n---\n`;
      }
    }
  }

  if (!context) context = "No relevant information found in the brain.\n";

  const querySkill = fs.readFileSync(path.join('meta', 'skills', 'query.md'), 'utf-8');
  const schema = fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8');
  const prompt = `${querySkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n${context}\n\n# USER QUESTION\n${question}\n\n# INSTRUCTIONS\nAnswer using the brain. Cite sources strictly.`;
  const result = runGemini(prompt);
  
  if (options.save && result.status === 0) {
    const slug = `analysis_${slugify(question)}`;
    const body = `---
title: Synthesis: ${question}
slug: ${slug}
tags: [analysis]
type: analysis
confidence: 0.7
mentions: 1
tier: 2
status: active
created_at: ${new Date().toISOString()}
updated_at: ${new Date().toISOString()}
source_count: 0
---

# Analysis: ${question}

## Summary
${result.stdout}

## Cross-References

---
<!-- TIMELINE: append-only below this line -->
- **${new Date().toISOString().split('T')[0]}**: Generated synthesis via query.
`;
    fs.writeFileSync(path.join('wiki', `${slug}.md`), body);
    console.log(`✅ Saved to wiki/${slug}.md`);
    internalRebuildIndex();
  }
});

program.command('process').action(async () => {
  const unprocessed = db.prepare('SELECT * FROM raw_entries WHERE processed = 0').all() as any[];
  if (unprocessed.length === 0) { console.log('✨ Empty.'); return; }
  const ingestSkill = fs.readFileSync(path.join('meta', 'skills', 'ingest.md'), 'utf-8');
  const schema = fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8');
  for (const entry of unprocessed) {
    console.log(`🧠 Processing: ${entry.title}`);
    const initialClaims = db.prepare('SELECT COUNT(*) as count FROM claim_sources WHERE raw_id = ?').get(entry.id) as any;
    const initialWikiMtime = fs.readdirSync('wiki').reduce((max, f) => Math.max(max, fs.statSync(path.join('wiki', f)).mtimeMs), 0);
    const initialLogSize = fs.existsSync(path.join('meta', 'log.md')) ? fs.statSync(path.join('meta', 'log.md')).size : 0;
    const prompt = `${ingestSkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n## RAW ENTRY\nID: ${entry.id}\nFile: ${entry.source_path}\nContent:\n${entry.content}\n\n# INSTRUCTIONS\nYou are an AI Librarian. Use 'bun brain.ts page create/update' with --source ${entry.id} and --claim \"...\".`;
    const result = runGemini(prompt, true);
    if (result.status === 0) {
      const finalClaims = db.prepare('SELECT COUNT(*) as count FROM claim_sources WHERE raw_id = ?').get(entry.id) as any;
      const finalWikiMtime = fs.readdirSync('wiki').reduce((max, f) => Math.max(max, fs.statSync(path.join('wiki', f)).mtimeMs), 0);
      const finalLogSize = fs.existsSync(path.join('meta', 'log.md')) ? fs.statSync(path.join('meta', 'log.md')).size : 0;
      const wikiChanged = finalWikiMtime > initialWikiMtime;
      const logChanged = finalLogSize > initialLogSize;
      const claimsAdded = finalClaims.count > initialClaims.count;
      if (wikiChanged && !claimsAdded) { console.error(`❌ ERR: Wiki mod without provenance.`); internalRebuildIndex(); }
      else if (!wikiChanged && !logChanged && !claimsAdded) console.warn(`⚠️ Warn: No action.`);
      else {
        db.prepare('UPDATE raw_entries SET processed = 1 WHERE id = ?').run(entry.id);
        internalRebuildIndex(); internalRebuildMarkdownIndex(); internalRebuildTimeline();
        const logMsg = `Processed raw entry ${entry.id}`;
        db.prepare('INSERT INTO operations_log (operation, details) VALUES (?, ?)').run('process', logMsg);
        if (!logChanged) fs.appendFileSync(path.join('meta', 'log.md'), `- ${new Date().toISOString().split('T')[0]}: ${logMsg}\n`);
      }
    }
  }
});

program.command('lint').option('--fix', 'Safe fixes only').action((options) => {
  console.log('🧹 Linting Brain...');
  const wikiFiles = fs.readdirSync('wiki').filter(f => f.endsWith('.md'));
  const findings: string[] = [];
  
  // 1. Broken Links
  const links = db.prepare('SELECT source_slug, target_slug FROM wiki_links').all() as any[];
  for (const link of links) if (!db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(link.target_slug)) findings.push(`- **Broken Link**: [[${link.source_slug}]] -> [[${link.target_slug}]]`);

  // 2. Structural Checks
  for (const file of wikiFiles) {
    const content = fs.readFileSync(path.join('wiki', file), 'utf-8');
    if (!content.includes('---')) findings.push(`- **Missing Header**: ${file}`);
    if (!content.includes('## Summary')) findings.push(`- **Missing Truth**: ${file}`);
    if (!content.includes('<!-- TIMELINE: append-only below this line -->')) {
      if (options.fix) {
        fs.appendFileSync(path.join('wiki', file), '\n---\n<!-- TIMELINE: append-only below this line -->\n');
        console.log(`✅ Fixed separator in ${file}`);
      } else findings.push(`- **Missing Timeline Separator**: ${file}`);
    }
  }

  // 3. Orphans & Provenance (Fixed age grace period)
  const orphans = db.prepare(`
    SELECT slug FROM wiki_pages 
    WHERE slug NOT IN (SELECT target_slug FROM wiki_links) 
    AND julianday(created_at) < julianday('now', '-7 days')
  `).all() as any[];
  orphans.forEach(o => findings.push(`- **Orphan Page**: [[${o.slug}]]`));
  const noProv = db.prepare('SELECT slug FROM wiki_pages WHERE source_count = 0 AND type != "analysis"').all() as any[];
  noProv.forEach(p => findings.push(`- **No Provenance**: [[${p.slug}]]`));

  // 4. Stale Pages
  const stale = db.prepare('SELECT slug FROM wiki_pages WHERE updated_at < date("now", "-30 days")').all() as any[];
  stale.forEach(s => findings.push(`- **Stale Page**: [[${s.slug}]]` || ''));

  const report = `# Lint Report\n\nGenerated: ${new Date().toLocaleString()}\n\n${findings.length > 0 ? findings.join('\n') : '✨ No issues found.'}\n`;
  fs.writeFileSync(path.join('meta', 'lint-report.md'), report);
  console.log(report);
});

program.command('maintain').action(async () => {
  const maintainSkill = fs.readFileSync(path.join('meta', 'skills', 'maintain.md'), 'utf-8');
  const prompt = `${maintainSkill}\n\n# CONTEXT\n\n## SCHEMA\n${fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8')}\n\n# INSTRUCTIONS\nPerform maintenance.`;
  const result = runGemini(prompt, true);
  if (result.status === 0) { internalRebuildIndex(); internalRebuildMarkdownIndex(); internalRebuildTimeline(); }
});

program.command('claim-add').argument('<slug>', 'Slug').argument('<claim>', 'Claim').argument('<raw_id>', 'Raw ID').action((slug, claim, raw_id) => {
  try { internalRecordClaim(slug, claim, Number(raw_id)); console.log(`✅ Claim recorded.`); } catch (e: any) { console.error(`❌ Error: ${e.message}`); process.exit(1); }
});

program.command('embed').description('Embed brain content').option('--all', 'Re-embed everything').argument('[slug]', 'Specific page to embed').action(async (slug, options) => {
  console.log('🧠 Generating Embeddings...');
  
  const ollamaCheck = await fetch('http://localhost:11434/api/tags').catch(() => null);
  if (!ollamaCheck || !ollamaCheck.ok) { console.error('❌ Ollama not running at localhost:11434'); process.exit(1); }
  
  if (options.all) {
    db.run('DELETE FROM chunks');
    console.log('🗑️ Cleared existing chunks.');
  } else if (slug) {
    db.prepare('DELETE FROM chunks WHERE page_slug = ? AND owner_type = "wiki"').run(slug);
  }

  let chunkCount = 0;
  const startTime = Date.now();

  // Wiki Pages
  const pagesQuery = slug ? db.prepare('SELECT slug FROM wiki_pages WHERE slug = ?').all(slug) : db.prepare('SELECT slug FROM wiki_pages WHERE slug NOT IN (SELECT DISTINCT page_slug FROM chunks WHERE owner_type = "wiki")').all();
  
  for (const page of pagesQuery as any[]) {
    const content = fs.readFileSync(path.join('wiki', `${page.slug}.md`), 'utf-8');
    const parts = content.split('<!-- TIMELINE: append-only below this line -->');
    
    // Truth section
    const truthChunks = chunkText(parts[0]);
    for (const text of truthChunks) {
      const vec = await embed(text);
      if (vec) {
        db.prepare('INSERT INTO chunks (owner_type, page_slug, chunk_type, text, embedding) VALUES (?, ?, ?, ?, ?)').run('wiki', page.slug, 'wiki_truth', text, Buffer.from(vec.buffer));
        chunkCount++;
      }
    }

    // Timeline section
    if (parts[1]) {
      const timelineChunks = chunkText(parts[1]);
      for (const text of timelineChunks) {
        const vec = await embed(text);
        if (vec) {
          db.prepare('INSERT INTO chunks (owner_type, page_slug, chunk_type, text, embedding) VALUES (?, ?, ?, ?, ?)').run('wiki', page.slug, 'wiki_timeline', text, Buffer.from(vec.buffer));
          chunkCount++;
        }
      }
    }
    process.stdout.write('.');
  }

  // Raw Entries
  if (!slug) {
    const rawQuery = db.prepare('SELECT id, content FROM raw_entries WHERE id NOT IN (SELECT DISTINCT raw_id FROM chunks WHERE owner_type = "raw")').all() as any[];
    for (const raw of rawQuery) {
      const chunks = chunkText(raw.content);
      for (const text of chunks) {
        const vec = await embed(text);
        if (vec) {
          db.prepare('INSERT INTO chunks (owner_type, raw_id, chunk_type, text, embedding) VALUES (?, ?, ?, ?, ?)').run('raw', raw.id, 'raw', text, Buffer.from(vec.buffer));
          chunkCount++;
        }
      }
      process.stdout.write('.');
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Embedded ${chunkCount} chunks in ${duration}s.`);
});

const page = program.command('page');
page.command('create').argument('<slug>', 'Slug').argument('<title>', 'Title').option('-c, --content <content>', 'Truth', '').option('-t, --tags <tags>', 'Tags', '').option('-a, --aliases <aliases>', 'Aliases', '').option('-y, --type <type>', 'Type', 'concept').option('-f, --confidence <confidence>', 'Confidence', '0.5').option('-m, --mentions <mentions>', 'Mentions', '1').option('-r, --tier <tier>', 'Tier', '3').option('-s, --source <raw_id>', 'Raw source').option('-k, --claim <claim>', 'Claim').action((slug, title, options) => {
  const filePath = path.join('wiki', `${slug}.md`);
  if (fs.existsSync(filePath)) { console.error(`❌ Exists`); process.exit(1); }
  const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
  const aliases = options.aliases ? options.aliases.split(',').map((a: string) => a.trim()) : [];
  const body = ['---', yaml.dump({ title, slug, aliases, tags, type: options.type, confidence: Number(options.confidence), mentions: Number(options.mentions), tier: Number(options.tier), status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source_count: options.source ? 1 : 0 }).trim(), '---', '', `# ${title}`, '', '## Summary', options.content, '', '## Cross-References', '', '---', '<!-- TIMELINE: append-only below this line -->'].join('\n');
  fs.writeFileSync(filePath, body);
  if (options.source && options.claim) { internalRebuildIndex(); internalRecordClaim(slug, options.claim, Number(options.source)); }
  console.log(`✅ Created ${slug}`);
});

page.command('update').argument('<slug>', 'Slug').argument('<content>', 'Content').option('-t, --title <title>', 'Title').option('-s, --source <raw_id>', 'Raw source').option('-k, --claim <claim>', 'Claim').option('--section <section>', 'Section', 'truth').action((slug, content, options) => {
  const filePath = path.join('wiki', `${slug}.md`);
  if (!fs.existsSync(filePath)) { console.error(`❌ Not found`); process.exit(1); }
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parts = fileContent.split('<!-- TIMELINE: append-only below this line -->');
  const headerAndTruth = parts[0];
  const existingTimeline = parts[1] || '';
  if (options.section === 'truth') {
    if (content.includes('<!-- TIMELINE: append-only below this line -->')) {
      const newTimeline = content.split('<!-- TIMELINE: append-only below this line -->')[1];
      if (existingTimeline.trim() && !newTimeline.includes(existingTimeline.trim())) { console.error(`❌ ERR: Timeline wiped.`); process.exit(1); }
      fs.writeFileSync(filePath, content);
    } else {
      const summarySplit = headerAndTruth.split('## Summary');
      const start = summarySplit[0];
      const rest = summarySplit.slice(1).join('## Summary');
      const afterSummary = rest.includes('## Cross-References') ? '## Cross-References' + rest.split('## Cross-References').slice(1).join('## Cross-References') : '## Cross-References';
      fs.writeFileSync(filePath, start + '## Summary\n' + content + '\n\n' + afterSummary + '\n---\n<!-- TIMELINE: append-only below this line -->' + existingTimeline);
    }
  } else {
    fs.writeFileSync(filePath, headerAndTruth + '<!-- TIMELINE: append-only below this line -->' + existingTimeline + '\n' + content);
  }
  if (options.source && options.claim) internalRecordClaim(slug, options.claim, Number(options.source));
  console.log(`✅ Updated ${slug}`);
});

const indexCmd = program.command('index');
indexCmd.command('rebuild').action(() => internalRebuildIndex());
indexCmd.command('rebuild-markdown').action(() => internalRebuildMarkdownIndex());

const timelineCmd = program.command('timeline');
timelineCmd.command('rebuild').action(() => internalRebuildTimeline());

program.parse();

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { execFileSync } from 'child_process';

// --- Configuration ---
export const BRAIN_ROOT = process.env.MT_BRAIN_ROOT || process.cwd();

export const PATHS = {
  raw: path.join(BRAIN_ROOT, 'raw'),
  wiki: path.join(BRAIN_ROOT, 'wiki'),
  meta: path.join(BRAIN_ROOT, 'meta'),
  db: path.join(BRAIN_ROOT, 'meta', 'brain.db'),
};

// Ensure directories exist
for (const p of [PATHS.raw, PATHS.wiki, PATHS.meta]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// --- Database ---
export const db = new Database(PATHS.db);
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
} catch (e) {}

export function initDb() {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);`);
  
  let currentVersion = 0;
  try {
    const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number } | undefined;
    if (row) currentVersion = row.version;
  } catch (e) {}

  // Base Tables (v1)
  db.run(`CREATE TABLE IF NOT EXISTS raw_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT NOT NULL, source_path TEXT UNIQUE, hash TEXT, processed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  db.run(`CREATE TABLE IF NOT EXISTS wiki_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, tags TEXT, status TEXT, source_count INTEGER DEFAULT 0, summary TEXT, type TEXT, confidence REAL DEFAULT 0.5, mentions INTEGER DEFAULT 1, tier INTEGER DEFAULT 3, created_at DATETIME, updated_at DATETIME);`);
  db.run(`CREATE TABLE IF NOT EXISTS wiki_aliases (alias TEXT PRIMARY KEY, slug TEXT, FOREIGN KEY(slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
  db.run(`CREATE TABLE IF NOT EXISTS wiki_links (source_slug TEXT, target_slug TEXT, PRIMARY KEY (source_slug, target_slug), FOREIGN KEY(source_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE, FOREIGN KEY(target_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
  db.run(`CREATE TABLE IF NOT EXISTS operations_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, operation TEXT, details TEXT);`);
  db.run(`CREATE TABLE IF NOT EXISTS claims (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_slug TEXT NOT NULL, claim_text TEXT NOT NULL, FOREIGN KEY(wiki_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
  db.run(`CREATE TABLE IF NOT EXISTS claim_sources (claim_id INTEGER NOT NULL, raw_id INTEGER NOT NULL, PRIMARY KEY (claim_id, raw_id), FOREIGN KEY(claim_id) REFERENCES claims(id) ON DELETE CASCADE, FOREIGN KEY(raw_id) REFERENCES raw_entries(id) ON DELETE CASCADE);`);
  try { db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(slug, title, content, tags);`); } catch (e) {}

  // v3: Chunks
  db.run(`CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_type TEXT NOT NULL CHECK(owner_type IN ('wiki', 'raw')), page_slug TEXT, raw_id INTEGER, chunk_type TEXT NOT NULL, text TEXT NOT NULL, embedding BLOB, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(page_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE, FOREIGN KEY(raw_id) REFERENCES raw_entries(id) ON DELETE CASCADE, CHECK ((owner_type = 'wiki' AND page_slug IS NOT NULL AND raw_id IS NULL) OR (owner_type = 'raw' AND raw_id IS NOT NULL AND page_slug IS NULL)));`);

  // v4: raw-entry provenance columns (source_type: channel, project: domain)
  const rawCols = db.prepare(`PRAGMA table_info(raw_entries)`).all() as Array<{ name: string }>;
  const colNames = new Set(rawCols.map(c => c.name));
  if (!colNames.has('source_type')) db.run(`ALTER TABLE raw_entries ADD COLUMN source_type TEXT NOT NULL DEFAULT 'raw'`);
  if (!colNames.has('project'))     db.run(`ALTER TABLE raw_entries ADD COLUMN project TEXT NOT NULL DEFAULT 'unknown'`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_raw_source_type ON raw_entries(source_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_raw_project     ON raw_entries(project)`);

  // v5: raw_events for streaming data (chains, chats)
  db.run(`CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,      -- 'human_chat', 'llm_chat', 'chain', 'soul'
    project TEXT NOT NULL,
    external_id TEXT UNIQUE,        -- chain_id:msg_id or session:turn
    chain_id TEXT,
    from_id TEXT,
    to_id TEXT,
    timestamp DATETIME NOT NULL,
    content TEXT NOT NULL,
    participants TEXT,              -- JSON array
    metadata TEXT,                  -- JSON object (for footer info)
    processed INTEGER DEFAULT 0,    -- 1 if ingested to wiki
    deduped INTEGER DEFAULT 0,      -- 1 if passed through normalization script
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_chain ON raw_events(chain_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_project ON raw_events(project)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_processed ON raw_events(processed)`);

  // v6: events_fts — targeted FTS over raw_events so imported sessions/chains
  // are findable via /search without waiting for the ingest pass. Vector-layer
  // events land in a later pass.
  const eventCols = db.prepare(`PRAGMA table_info(raw_events)`).all() as Array<{ name: string }>;
  if (!eventCols.some(c => c.name === 'title')) db.run(`ALTER TABLE raw_events ADD COLUMN title TEXT`);
  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      external_id UNINDEXED,
      project UNINDEXED,
      source_type UNINDEXED,
      title,
      content
    )`);
  } catch (e) {}
  // Backfill events_fts from any pre-existing raw_events rows.
  const ftsCount = (db.prepare(`SELECT COUNT(*) as c FROM events_fts`).get() as any).c;
  const eventCount = (db.prepare(`SELECT COUNT(*) as c FROM raw_events`).get() as any).c;
  if (eventCount > 0 && ftsCount === 0) {
    db.run(`INSERT INTO events_fts (external_id, project, source_type, title, content)
            SELECT external_id, project, source_type, COALESCE(title, ''), content FROM raw_events`);
  }

  // v7: importer filesystem-state cache for incremental session imports
  db.run(`CREATE TABLE IF NOT EXISTS import_state (
    source_path TEXT PRIMARY KEY,
    last_mtime REAL NOT NULL,
    last_imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  db.run('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, 7)');
}

// --- Common Logic ---

export function cosine_sim(a: Buffer | null | undefined, b: Buffer | null | undefined): number {
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

export async function embed(text: string): Promise<Float32Array | null> {
  try {
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
    });
    if (!res.ok) return null;
    const data = await res.json() as { embedding: number[] };
    return new Float32Array(data.embedding);
  } catch (e) { return null; }
}

export function getHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export function slugify(text: string): string {
  return text.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]+/gu, '').toLowerCase();
}

export function chunkText(text: string, maxTokens = 400, overlapFraction = 0.2): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let currentChunkWords: string[] = [];
  let currentWordCount = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentChunkWords.push(word);
    if (word.trim().length > 0) currentWordCount++;
    if (currentWordCount >= maxTokens) {
      chunks.push(currentChunkWords.join(''));
      const overlapWordsCount = Math.floor(maxTokens * overlapFraction);
      let backtrackWords = 0; let backtrackIndex = currentChunkWords.length - 1;
      while (backtrackIndex >= 0 && backtrackWords < overlapWordsCount) { if (currentChunkWords[backtrackIndex].trim().length > 0) backtrackWords++; backtrackIndex--; }
      currentChunkWords = currentChunkWords.slice(backtrackIndex + 1);
      currentWordCount = overlapWordsCount;
    }
  }
  if (currentWordCount > 0) chunks.push(currentChunkWords.join(''));
  return chunks;
}

// --- Shared Operations ---

export type SearchResult = {
  slug: string | null;
  title: string;
  score: number;
  snippet: string;
  source: 'wiki' | 'raw' | 'event';
  source_type?: string;
  project?: string;
  external_id?: string;
};

export type SearchOpts = {
  sourceTypes?: string[];
  projects?: string[];
};

function buildFtsQuery(query: string): string | null {
  const sanitized = query
    .normalize('NFKC')
    // Strip FTS operators/punctuation so MATCH sees bag-of-words, not syntax.
    .replace(/["'^*:\-]/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/[^\p{L}\p{N}_\s]+/gu, ' ')
    .trim();

  if (!sanitized) return null;

  const terms = sanitized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  return Array.from(new Set(terms)).join(' AND ');
}

function applyEventLane(results: SearchResult[], limit: number): SearchResult[] {
  const eventQuota = Math.min(
    results.filter(r => r.source === 'event').length,
    Math.ceil(limit * 0.3),
  );
  if (eventQuota === 0) return results.slice(0, limit);

  // Reserve a small event lane so wiki's dual-arm RRF does not crowd events out.
  const selected: SearchResult[] = [];
  const deferred: SearchResult[] = [];
  let eventsSelected = 0;

  for (const result of results) {
    if (selected.length === limit) break;
    if (result.source === 'event') {
      selected.push(result);
      eventsSelected++;
      continue;
    }

    const remainingSlots = limit - selected.length;
    const remainingEventQuota = eventQuota - eventsSelected;
    if (remainingSlots <= remainingEventQuota) {
      deferred.push(result);
      continue;
    }

    selected.push(result);
  }

  if (selected.length < limit) {
    for (const result of deferred) {
      if (selected.length === limit) break;
      selected.push(result);
    }
  }

  return selected;
}

export async function hybridSearch(query: string, limit: number = 10, opts: SearchOpts = {}): Promise<SearchResult[]> {
  const sourceTypes = opts.sourceTypes && opts.sourceTypes.length > 0 ? opts.sourceTypes : null;
  const projects    = opts.projects    && opts.projects.length    > 0 ? opts.projects    : null;
  const hasFilters  = sourceTypes !== null || projects !== null;
  const ftsQuery    = buildFtsQuery(query);

  if (!ftsQuery) return [];

  const queryEmbedding = await embed(query);

  // FTS runs over the wiki search_index only. Wiki pages are project-agnostic
  // compiled truth, so hard source/project filters skip the wiki arm entirely.
  const ftsResults: any[] = hasFilters
    ? []
    : db.prepare(`SELECT slug, title, content, bm25(search_index) as rank FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 50`).all(ftsQuery) as any[];

  let vectorResults: any[] = [];
  if (queryEmbedding) {
    const queryBuffer = Buffer.from(queryEmbedding.buffer);
    let sql = `SELECT c.owner_type, c.page_slug, c.raw_id, c.chunk_type, c.text, c.embedding,
                      COALESCE(w.title, r.title) as title,
                      r.source_type as source_type,
                      r.project as project
               FROM chunks c
               LEFT JOIN wiki_pages w ON c.page_slug = w.slug
               LEFT JOIN raw_entries r ON c.raw_id = r.id
               WHERE c.embedding IS NOT NULL`;
    const params: any[] = [];
    if (hasFilters) {
      // Filters imply source provenance — only raw-owned chunks can match.
      sql += ` AND c.owner_type = 'raw'`;
      if (sourceTypes) {
        sql += ` AND r.source_type IN (${sourceTypes.map(() => '?').join(',')})`;
        params.push(...sourceTypes);
      }
      if (projects) {
        sql += ` AND r.project IN (${projects.map(() => '?').join(',')})`;
        params.push(...projects);
      }
    }
    const chunks = db.prepare(sql).all(...params) as any[];
    vectorResults = chunks.map(c => {
      let cos_score = cosine_sim(c.embedding, queryBuffer);
      if (c.chunk_type === 'wiki_truth') cos_score += 0.1;
      return { ...c, cos_score };
    }).sort((a, b) => b.cos_score - a.cos_score).slice(0, 50);
  }

  // Events FTS — raw-tier provenance-scoped streaming data (sessions, chains).
  // Always participates; honors source_type and project filters when set.
  let eventSql = `SELECT external_id, title, content, source_type, project, bm25(events_fts) as rank
                  FROM events_fts WHERE events_fts MATCH ?`;
  const eventParams: any[] = [ftsQuery];
  if (sourceTypes) {
    eventSql += ` AND source_type IN (${sourceTypes.map(() => '?').join(',')})`;
    eventParams.push(...sourceTypes);
  }
  if (projects) {
    eventSql += ` AND project IN (${projects.map(() => '?').join(',')})`;
    eventParams.push(...projects);
  }
  eventSql += ` ORDER BY rank LIMIT 50`;
  let eventResults: any[] = [];
  try { eventResults = db.prepare(eventSql).all(...eventParams) as any[]; } catch (e) {}

  const rrfScores = new Map<string, SearchResult>();
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
        source: r.owner_type as 'wiki' | 'raw',
        source_type: r.source_type || undefined,
        project: r.project || undefined,
      });
    }
    const current = rrfScores.get(uid)!;
    current.score += score;
    if (index === 0 || current.snippet.length > 300) current.snippet = r.text;
  });

  eventResults.forEach((r, index) => {
    const uid = `event:${r.external_id}`;
    const score = 1 / (60 + index + 1);
    if (!rrfScores.has(uid)) {
      rrfScores.set(uid, {
        slug: null,
        title: r.title || r.external_id,
        score: 0,
        snippet: (r.content || '').substring(0, 200) + '...',
        source: 'event',
        source_type: r.source_type || undefined,
        project: r.project || undefined,
        external_id: r.external_id,
      });
    }
    rrfScores.get(uid)!.score += score;
  });

  const ranked = Array.from(rrfScores.values()).sort((a, b) => b.score - a.score);
  return applyEventLane(ranked, limit);
}

export function getStats() {
  const version = (db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any)?.version || 0;
  const totalChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
  const embeddedChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks WHERE embedding IS NOT NULL').get() as any).c;
  const pages = (db.prepare('SELECT COUNT(*) as c FROM wiki_pages').get() as any).c;
  const raws = (db.prepare('SELECT COUNT(*) as c FROM raw_entries').get() as any).c;
  const links = (db.prepare('SELECT COUNT(*) as c FROM wiki_links').get() as any).c;
  const claims = (db.prepare('SELECT COUNT(*) as c FROM claims').get() as any).c;
  const avgSource = (db.prepare('SELECT AVG(source_count) as a FROM wiki_pages').get() as any).a || 0;

  return {
    version,
    pages,
    raws,
    links,
    claims,
    totalChunks,
    embeddedChunks,
    avgSource: Number(avgSource.toFixed(2)),
  };
}

export function getProjects(): string[] {
  const rows = db.prepare('SELECT DISTINCT project FROM raw_entries WHERE project IS NOT NULL ORDER BY project ASC').all() as any[];
  return rows.map(r => r.project);
}

export async function runGemini(prompt: string, yolo: boolean = false) {
  const args = yolo ? ['--yolo', `-p=${prompt}`] : [`-p=${prompt}`];
  try {
    const proc = Bun.spawn(['gemini', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exit === 0) return { status: 0, stdout };
    return { status: exit || 1, stderr: stderr || stdout || 'gemini failed' };
  } catch (e: any) {
    return { status: 1, stderr: e.message || String(e) };
  }
}

export async function queryBrain(question: string, opts: SearchOpts = {}) {
  const hasEmbeddings = (db.prepare('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL').get() as any).count > 0;
  let context = "";
  if (hasEmbeddings) {
    const results = await hybridSearch(question, 10, opts);
    const wikiHits = results.filter(r => r.source === 'wiki');
    const rawHits = results.filter(r => r.source === 'raw');
    if (wikiHits.length > 0) {
      context += "## RELEVANT WIKI PAGES\n\n";
      for (let i = 0; i < Math.min(wikiHits.length, 3); i++) {
        if (wikiHits[i].slug) {
          const body = fs.readFileSync(path.join(PATHS.wiki, `${wikiHits[i].slug}.md`), 'utf-8');
          context += `### [[${wikiHits[i].slug}|${wikiHits[i].title}]]\n${body}\n---\n`;
        }
      }
    }
    if (rawHits.length > 0) {
      context += "\n## RAW EVIDENCE\n\n";
      for (let i = 0; i < Math.min(rawHits.length, 5); i++) context += `### ${rawHits[i].title}\n${rawHits[i].snippet}\n---\n`;
    }
  } else {
    const results = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ? LIMIT 5').all(`"${question}"`) as any[];
    if (results.length > 0) {
      context = "## RELEVANT WIKI PAGES\n\n";
      for (const res of results) {
        const body = fs.readFileSync(path.join(PATHS.wiki, `${res.slug}.md`), 'utf-8');
        context += `### [[${res.slug}|${res.title}]]\n${body}\n---\n`;
      }
    }
  }
  const querySkill = fs.readFileSync(path.join(PATHS.meta, 'skills', 'query.md'), 'utf-8');
  const schema = fs.readFileSync(path.join(PATHS.meta, 'schema.md'), 'utf-8');
  const prompt = `${querySkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n${context}\n\n# USER QUESTION\n${question}\n\n# INSTRUCTIONS\nAnswer using the brain. Cite sources strictly.`;
  return runGemini(prompt);
}

export async function validateClaim(claim: string, opts: SearchOpts = {}) {
  const results = await hybridSearch(claim, 5, opts);
  let context = "";
  for (const r of results) {
    if (r.source === 'wiki' && r.slug) {
      const body = fs.readFileSync(path.join(PATHS.wiki, `${r.slug}.md`), 'utf-8');
      context += `### [[${r.slug}|${r.title}]]\n${body}\n---\n`;
    } else {
      context += `### ${r.title}\n${r.snippet}\n---\n`;
    }
  }
  const prompt = `Fact-check the claim against the context.\n\n# CONTEXT\n${context}\n\n# CLAIM\n${claim}\n\n# INSTRUCTIONS\nReturn exactly ONE verdict: ✅ confirmed, ⚠️ partial, ❌ contradicted, ❓ no data. Cite evidence.`;
  return runGemini(prompt);
}

export type AddOpts = {
  sourceType?: string;
  project?: string;
};

export function addToBrain(content: string, title?: string, opts: AddOpts = {}) {
  const sourceType = (opts.sourceType || 'raw').trim() || 'raw';
  const project    = (opts.project    || 'unknown').trim() || 'unknown';
  const hash = getHash(content);
  if (db.prepare('SELECT 1 FROM raw_entries WHERE hash = ?').get(hash)) {
    return { status: 'duplicate', title: '', path: '' };
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.md`;
  // Layout: raw/<source_type>/<project>/<timestamp>.md
  const dirPath  = path.join(PATHS.raw, sourceType, project);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  const filePath = path.join(dirPath, filename);
  const finalTitle = title || `Entry ${timestamp}`;
  fs.writeFileSync(filePath, `# ${finalTitle}\n\nAdded: ${new Date().toLocaleString()}\n\n---\n\n${content}`);
  db.prepare('INSERT INTO raw_entries (title, content, source_path, hash, source_type, project) VALUES (?, ?, ?, ?, ?, ?)')
    .run(finalTitle, content, filePath, hash, sourceType, project);
  return { status: 'saved', title: finalTitle, path: filePath };
}

export async function embedBrain(slug?: string) {
  let count = 0;
  const pages = slug ? db.prepare('SELECT slug FROM wiki_pages WHERE slug = ?').all(slug) : db.prepare('SELECT slug FROM wiki_pages').all();
  for (const p of pages as any[]) {
    const content = fs.readFileSync(path.join(PATHS.wiki, `${p.slug}.md`), 'utf-8');
    const parts = content.split('<!-- TIMELINE: append-only below this line -->');
    const sections = [{ text: parts[0], type: 'wiki_truth' }, { text: (parts[1] || '').trim(), type: 'wiki_timeline' }];
    for (const sec of sections) {
      if (!sec.text) continue;
      const chunks = chunkText(sec.text);
      for (const t of chunks) {
        const vec = await embed(t);
        if (vec) {
          const buf = Buffer.from(vec.buffer);
          const current = db.prepare(`SELECT embedding FROM chunks WHERE owner_type = 'wiki' AND page_slug = ?`).all(p.slug) as any[];
          if (!current.some(c => cosine_sim(c.embedding, buf) > 0.98)) {
            db.prepare('INSERT INTO chunks (owner_type, page_slug, chunk_type, text, embedding) VALUES (?, ?, ?, ?, ?)').run('wiki', p.slug, sec.type, t, buf);
            count++;
          }
        }
      }
    }
  }
  return { count };
}

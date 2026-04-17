import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

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
  const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number } | undefined;
  let currentVersion = row ? row.version : 0;

  if (currentVersion < 1) {
    db.run(`CREATE TABLE IF NOT EXISTS raw_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT NOT NULL, source_path TEXT UNIQUE, hash TEXT, processed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    db.run(`CREATE TABLE IF NOT EXISTS wiki_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, tags TEXT, status TEXT, source_count INTEGER DEFAULT 0, summary TEXT, type TEXT, confidence REAL DEFAULT 0.5, mentions INTEGER DEFAULT 1, tier INTEGER DEFAULT 3, created_at DATETIME, updated_at DATETIME);`);
    db.run(`CREATE TABLE IF NOT EXISTS wiki_aliases (alias TEXT PRIMARY KEY, slug TEXT, FOREIGN KEY(slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
    db.run(`CREATE TABLE IF NOT EXISTS wiki_links (source_slug TEXT, target_slug TEXT, PRIMARY KEY (source_slug, target_slug), FOREIGN KEY(source_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE, FOREIGN KEY(target_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
    db.run(`CREATE TABLE IF NOT EXISTS operations_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, operation TEXT, details TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS claims (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_slug TEXT NOT NULL, claim_text TEXT NOT NULL, FOREIGN KEY(wiki_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE);`);
    db.run(`CREATE TABLE IF NOT EXISTS claim_sources (claim_id INTEGER NOT NULL, raw_id INTEGER NOT NULL, PRIMARY KEY (claim_id, raw_id), FOREIGN KEY(claim_id) REFERENCES claims(id) ON DELETE CASCADE, FOREIGN KEY(raw_id) REFERENCES raw_entries(id) ON DELETE CASCADE);`);
    try { db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(slug, title, content, tags);`); } catch (e) {}
    db.run('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, 3)');
  }
}

// --- Logic ---

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

export type SearchResult = {
  slug: string | null;
  title: string;
  score: number;
  snippet: string;
  source: 'wiki' | 'raw';
};

export async function hybridSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);
  const ftsResults = db.prepare(`SELECT slug, title, content, bm25(search_index) as rank FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 50`).all(`"${query}"`) as any[];
  
  let vectorResults: any[] = [];
  if (queryEmbedding) {
    const queryBuffer = Buffer.from(queryEmbedding.buffer);
    const chunks = db.prepare(`SELECT c.owner_type, c.page_slug, c.raw_id, c.chunk_type, c.text, c.embedding, COALESCE(w.title, r.title) as title FROM chunks c LEFT JOIN wiki_pages w ON c.page_slug = w.slug LEFT JOIN raw_entries r ON c.raw_id = r.id WHERE c.embedding IS NOT NULL`).all() as any[];
    vectorResults = chunks.map(c => {
      let cos_score = cosine_sim(c.embedding, queryBuffer);
      if (c.chunk_type === 'wiki_truth') cos_score += 0.1;
      return { ...c, cos_score };
    }).sort((a, b) => b.cos_score - a.cos_score).slice(0, 50);
  }

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
      rrfScores.set(uid, { slug: r.page_slug, title: r.title, score: 0, snippet: r.text, source: r.owner_type as 'wiki' | 'raw' });
    }
    const current = rrfScores.get(uid)!;
    current.score += score;
    if (index === 0 || current.snippet.length > 300) current.snippet = r.text;
  });

  return Array.from(rrfScores.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function getStats() {
  const totalChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
  const embeddedChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks WHERE embedding IS NOT NULL').get() as any).c;
  const pages = (db.prepare('SELECT COUNT(*) as c FROM wiki_pages').get() as any).c;
  const raws = (db.prepare('SELECT COUNT(*) as c FROM raw_entries').get() as any).c;
  const links = (db.prepare('SELECT COUNT(*) as c FROM wiki_links').get() as any).c;
  const claims = (db.prepare('SELECT COUNT(*) as c FROM claims').get() as any).c;
  const avgSource = (db.prepare('SELECT AVG(source_count) as a FROM wiki_pages').get() as any).a || 0;

  return {
    pages,
    raws,
    links,
    claims,
    totalChunks,
    embeddedChunks,
    avgSource: Number(avgSource.toFixed(2)),
  };
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

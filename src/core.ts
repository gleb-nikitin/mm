import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
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
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
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

  // v8: extend import_state for live-agent dashboard
  const importCols = db.prepare(`PRAGMA table_info(import_state)`).all() as Array<{ name: string }>;
  const importColNames = new Set(importCols.map(c => c.name));
  if (!importColNames.has('provider'))          db.run(`ALTER TABLE import_state ADD COLUMN provider TEXT`);
  if (!importColNames.has('external_id'))       db.run(`ALTER TABLE import_state ADD COLUMN external_id TEXT`);
  if (!importColNames.has('project'))           db.run(`ALTER TABLE import_state ADD COLUMN project TEXT`);
  if (!importColNames.has('cwd'))               db.run(`ALTER TABLE import_state ADD COLUMN cwd TEXT`);
  if (!importColNames.has('model'))             db.run(`ALTER TABLE import_state ADD COLUMN model TEXT`);
  if (!importColNames.has('last_user_snippet')) db.run(`ALTER TABLE import_state ADD COLUMN last_user_snippet TEXT`);
  if (!importColNames.has('min_turns_ok'))      db.run(`ALTER TABLE import_state ADD COLUMN min_turns_ok INTEGER DEFAULT 1`);

  // v9: claim_sources_event — provenance table for events (parallel to claim_sources).
  // Events can't share claim_sources.raw_id because raw_entries.id and raw_events.id are
  // independent ID spaces. Two tables keep FK integrity clean; source_count unions them.
  db.run(`CREATE TABLE IF NOT EXISTS claim_sources_event (
    claim_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    PRIMARY KEY (claim_id, event_id),
    FOREIGN KEY(claim_id) REFERENCES claims(id) ON DELETE CASCADE,
    FOREIGN KEY(event_id) REFERENCES raw_events(id) ON DELETE CASCADE
  )`);

  // v10: raw_events.chunked — set by `scripts/chunk-events.ts` once a session has
  // been written to disk as one or more `raw/events/<project>/*.md` chunks. Distinct
  // from `processed` (which means "ingested into the wiki") so that ad-hoc
  // `brain ingest-event <id>` and the chunker→raw_entries pipeline can coexist.
  const evCols2 = db.prepare(`PRAGMA table_info(raw_events)`).all() as Array<{ name: string }>;
  if (!evCols2.some(c => c.name === 'chunked')) db.run(`ALTER TABLE raw_events ADD COLUMN chunked INTEGER DEFAULT 0`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_chunked ON raw_events(chunked)`);

  // v11.1: raw_events.content_hash — enables incremental re-import when a session
  // file under a stable external_id has grown. Importers used to do INSERT OR
  // IGNORE keyed on external_id, silently dropping new turns on subsequent runs.
  // Now: if hash differs on the same external_id, update content + reset chunked.
  if (!evCols2.some(c => c.name === 'content_hash')) db.run(`ALTER TABLE raw_events ADD COLUMN content_hash TEXT`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_hash ON raw_events(content_hash)`);

  // v11: atomic artifacts + virtual narrative chunks. See agent/docs/2026-04-20-v11-plan.md.
  db.run(`CREATE TABLE IF NOT EXISTS artifacts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project          TEXT NOT NULL,
    type             TEXT NOT NULL,
    data             TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL,
    superseded_by    INTEGER,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (superseded_by) REFERENCES artifacts(id) ON DELETE SET NULL
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_idempotency ON artifacts(project, type, idempotency_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_project_type ON artifacts(project, type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_status       ON artifacts(status)`);

  db.run(`CREATE TABLE IF NOT EXISTS artifact_sources (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id      INTEGER NOT NULL,
    source_raw_id    INTEGER,
    source_event_id  INTEGER,
    span_start       INTEGER,
    span_end         INTEGER,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (artifact_id)     REFERENCES artifacts(id)   ON DELETE CASCADE,
    FOREIGN KEY (source_raw_id)   REFERENCES raw_entries(id) ON DELETE SET NULL,
    FOREIGN KEY (source_event_id) REFERENCES raw_events(id)  ON DELETE SET NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_artifact_sources_artifact ON artifact_sources(artifact_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_artifact_sources_raw      ON artifact_sources(source_raw_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_artifact_sources_event    ON artifact_sources(source_event_id)`);

  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
      artifact_id UNINDEXED,
      project     UNINDEXED,
      type        UNINDEXED,
      text
    )`);
  } catch (e) {}

  db.run(`CREATE TABLE IF NOT EXISTS chunks_virtual (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project         TEXT NOT NULL,
    source_event_id INTEGER NOT NULL,
    chunk_index     INTEGER NOT NULL,
    chunk_total     INTEGER NOT NULL,
    segment_start   INTEGER NOT NULL,
    segment_end     INTEGER NOT NULL,
    filter_version  INTEGER NOT NULL,
    processed       INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_event_id) REFERENCES raw_events(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_virtual_project_processed ON chunks_virtual(project, processed)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_virtual_source_event      ON chunks_virtual(source_event_id)`);

  // v12: R1 session-tracker linkage index.
  db.run(`CREATE TABLE IF NOT EXISTS session_index (
    vendor TEXT NOT NULL CHECK(vendor IN ('claude','codex','gemini')),
    session_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    raw_event_id INTEGER REFERENCES raw_events(id) ON DELETE SET NULL,
    participant_id TEXT,
    project TEXT NOT NULL,
    role TEXT,
    project_role TEXT,
    cwd TEXT,
    model TEXT,
    started_at TEXT,
    last_activity_at TEXT NOT NULL,
    last_imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_mtime REAL NOT NULL,
    last_log_line TEXT,
    state TEXT NOT NULL CHECK(state IN ('working','idle','wedged','completed','orphan')),
    orphan_reason TEXT,
    metadata TEXT,
    PRIMARY KEY(vendor, session_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_project_role_state_activity ON session_index(project_role, state, last_activity_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_participant_activity ON session_index(participant_id, last_activity_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_state_activity ON session_index(state, last_activity_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_source_path ON session_index(source_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_project_state_activity ON session_index(project, state, last_activity_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_project_role_filter ON session_index(project, role, state, last_activity_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_index_session_id ON session_index(session_id)`);

  db.run(`CREATE TABLE IF NOT EXISTS session_message_links (
    chain_msg_id TEXT PRIMARY KEY,
    chain TEXT,
    seq INTEGER,
    from_id TEXT,
    to_id TEXT,
    vendor TEXT NOT NULL,
    session_id TEXT NOT NULL,
    participant_id TEXT,
    source_path TEXT,
    confidence TEXT NOT NULL CHECK(confidence IN ('exact','footer','none')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vendor, session_id) REFERENCES session_index(vendor, session_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_message_links_session ON session_message_links(vendor, session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_message_links_chain ON session_message_links(chain, seq)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_message_links_participant ON session_message_links(participant_id)`);

  // v13: R1 cost attribution by session.
  db.run(`CREATE TABLE IF NOT EXISTS session_usage (
    vendor TEXT NOT NULL CHECK(vendor IN ('claude','codex','gemini')),
    session_id TEXT NOT NULL,
    participant_id TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    cost_breakdown TEXT NOT NULL,
    pricing_source TEXT NOT NULL,
    priced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(vendor, session_id),
    FOREIGN KEY(vendor, session_id) REFERENCES session_index(vendor, session_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_usage_participant ON session_usage(participant_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_usage_cost ON session_usage(cost_usd DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_usage_session_id ON session_usage(session_id)`);

  // v14: R1 session lifecycle event stream for Watchdog/R4.
  db.run(`CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL CHECK(event_type IN ('session_started','session_active','session_idle','session_wedged','session_completed','session_orphaned')),
    vendor TEXT NOT NULL,
    session_id TEXT NOT NULL,
    participant_id TEXT,
    project_role TEXT,
    timestamp TEXT NOT NULL,
    last_log_line TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vendor, session_id) REFERENCES session_index(vendor, session_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(vendor, session_id, id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_events_id ON session_events(id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_events_project_role ON session_events(project_role, id)`);

  db.run('INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, 14)');
}

// --- Common Logic ---

// Resolve which ac msg.db to read. Precedence: explicit env override > Prod DB
// (Aurora Core.app data dir, the live write target) > ac workspace DB (used by
// tests and standalone bun invocations). Env wins even if the target doesn't
// exist — caller's existsSync check treats that as "silent fallback".
export interface AcDbPathOpts {
  envValue?: string;
  prodPath?: string;
  workspacePath?: string;
}

export function resolveAcDbPath(opts: AcDbPathOpts = {}): string {
  const envValue = opts.envValue ?? process.env.MT_AC_DB_PATH;
  if (envValue) return envValue;
  const prodPath = opts.prodPath
    ?? path.join(os.homedir(), 'Library/Application Support/com.aurora.core/data/msg.db');
  if (fs.existsSync(prodPath)) return prodPath;
  return opts.workspacePath ?? '/Users/glebnikitin/work/code/ac/data/msg.db';
}

// Resolve external session ids to ac participant ids (e.g. "mm_cto") by
// reading ac's msg.db read-only. Fails silently: if the DB is missing or
// the query errors, returns an empty map and mm renders today's shape.
export function resolveParticipantIds(externalIds: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (externalIds.length === 0) return result;

  const acDbPath = resolveAcDbPath();
  if (!fs.existsSync(acDbPath)) return result;

  let acDb: Database | null = null;
  try {
    acDb = new Database(acDbPath, { readonly: true });
    const placeholders = externalIds.map(() => '?').join(',');
    const rows = acDb.prepare(
      `SELECT active_session_id AS id, id AS participant_id
       FROM participants
       WHERE active_session_id IN (${placeholders})`
    ).all(...externalIds) as Array<{ id: string; participant_id: string }>;
    for (const row of rows) {
      if (row.participant_id) result.set(row.id, row.participant_id);
    }
  } catch {
    // Silent fallback — mm must stay runnable standalone.
  } finally {
    if (acDb) {
      try { acDb.close(); } catch {}
    }
  }
  return result;
}

export type ActiveAgentRow = {
  participant_id: string | null;
  provider: string;
  project: string;
  seconds_ago: number;
  model: string | null;
  last_user_snippet: string | null;
  external_id: string | null;
  cwd: string | null;
};

export function getActiveAgents(opts: { maxAgeSeconds?: number; project?: string } = {}): ActiveAgentRow[] {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 300;
  const clauses: string[] = [
    "(strftime('%s', 'now') - (last_mtime / 1000.0)) <= ?",
    "provider IS NOT NULL AND provider != 'unknown'",
    "project IS NOT NULL AND project != 'unknown'",
    "(min_turns_ok = 1 OR last_user_snippet IS NOT NULL)",
  ];
  const params: any[] = [maxAgeSeconds];
  if (opts.project) { clauses.push('project = ?'); params.push(opts.project); }
  const rows = db.prepare(`
    SELECT
      provider, project, cwd, external_id, model, last_user_snippet,
      CAST(strftime('%s', 'now') - (last_mtime / 1000.0) AS INTEGER) as seconds_ago
    FROM import_state
    WHERE ${clauses.join(' AND ')}
    ORDER BY seconds_ago ASC
  `).all(...params) as any[];
  const externalIds = rows.map(r => r.external_id).filter(Boolean) as string[];
  const participantMap = resolveParticipantIds(externalIds);
  return rows.map(r => ({
    participant_id: r.external_id ? (participantMap.get(r.external_id) ?? null) : null,
    provider: r.provider,
    project: r.project,
    seconds_ago: r.seconds_ago,
    model: r.model,
    last_user_snippet: r.last_user_snippet,
    external_id: r.external_id,
    cwd: r.cwd,
  }));
}

export function renderActiveAgentsMarkdown(agents: ActiveAgentRow[], maxAgeSeconds: number = 300): string {
  const nowIso = new Date().toISOString();
  let md = `# Active agents (last ${Math.floor(maxAgeSeconds / 60)} min)\n\n`;
  md += `_Generated: ${nowIso}_\n\n`;

  if (agents.length === 0) {
    md += `_No agents active._\n`;
    return md;
  }

  for (const a of agents) {
    const timeStr = formatRelativeTime(a.seconds_ago);
    if (a.participant_id) {
      md += `- **${a.participant_id}** · ${a.provider || 'unknown'} · \`${a.project || 'unknown'}\` · ${timeStr} ago · \`${a.model || 'unknown'}\`\n`;
    } else {
      md += `- **${a.provider || 'unknown'}** · \`${a.project || 'unknown'}\` · ${timeStr} ago · \`${a.model || 'unknown'}\`\n`;
    }
    md += `  cwd: \`${a.cwd || 'unknown'}\`\n`;
    md += `  external_id: \`${a.external_id || 'unknown'}\`\n`;
    if (a.last_user_snippet) {
      md += `  last user turn: "${a.last_user_snippet}"\n`;
    }
    md += `\n`;
  }

  return md.trim();
}

function formatRelativeTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

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

// --- Provenance helpers (Option A: timeline citations = provenance) ---
//
// Markdown is the source of truth. If a wiki timeline cites a raw file's path
// or an event's external_id, that's provenance — even if the agent didn't call
// the CLI. Used by `brain process` retro-sweep and by `brain ingest-event`.

export function wikiPath(slug: string): string {
  return path.join(PATHS.wiki, `${slug}.md`);
}

export function walkWiki(): Array<{ fullPath: string; slug: string }> {
  const results: Array<{ fullPath: string; slug: string }> = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.md')) continue;
      const slug = path.relative(PATHS.wiki, full).replace(/\.md$/, '').replace(/\\/g, '/');
      results.push({ fullPath: full, slug });
    }
  }
  walk(PATHS.wiki);
  return results;
}

export function snapshotWiki(): Map<string, number> {
  const snap = new Map<string, number>();
  for (const { fullPath, slug } of walkWiki()) {
    try { snap.set(slug, fs.statSync(fullPath).mtimeMs); } catch {}
  }
  return snap;
}

export function detectWikiChanges(before: Map<string, number>): string[] {
  const changed: string[] = [];
  for (const { fullPath, slug } of walkWiki()) {
    const now = fs.statSync(fullPath).mtimeMs;
    if ((before.get(slug) ?? -1) < now) changed.push(fullPath);
  }
  return changed;
}

function readTimeline(wikiFilePath: string): string {
  const content = fs.readFileSync(wikiFilePath, 'utf-8');
  const parts = content.split('<!-- TIMELINE: append-only below this line -->');
  return parts[1] || '';
}

export function timelineCitesRaw(wikiFilePath: string, rawSourcePath: string): boolean {
  const rel = path.relative(BRAIN_ROOT, rawSourcePath);
  return readTimeline(wikiFilePath).includes(rel);
}

export function timelineCitesEvent(wikiFilePath: string, externalId: string): boolean {
  return readTimeline(wikiFilePath).includes(`event:${externalId}`);
}

export function refreshSourceCount(slug: string) {
  db.prepare(`UPDATE wiki_pages SET source_count = (
    SELECT COUNT(*) FROM (
      SELECT 'r' || raw_id AS s FROM claim_sources
        WHERE claim_id IN (SELECT id FROM claims WHERE wiki_slug = ?)
      UNION
      SELECT 'e' || event_id AS s FROM claim_sources_event
        WHERE claim_id IN (SELECT id FROM claims WHERE wiki_slug = ?)
    )
  ) WHERE slug = ?`).run(slug, slug, slug);
}

function claimTextFromTimelineLine(rawLine: string): string {
  return rawLine
    .replace(/^\s*-\s*/, '')
    .replace(/^\*\*[^*]+\*\*:\s*/, '')
    .replace(/\s*Source:.*$/, '')
    .trim();
}

export function backfillClaimsFromTimeline(rawId: number, rawSourcePath: string, wikiFiles: string[]): number {
  const rel = path.relative(BRAIN_ROOT, rawSourcePath);
  let inserted = 0;
  for (const wikiFile of wikiFiles) {
    const slug = path.relative(PATHS.wiki, wikiFile).replace(/\.md$/, '').replace(/\\/g, '/');
    if (!db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug)) continue;
    const timeline = readTimeline(wikiFile);
    for (const rawLine of timeline.split('\n')) {
      if (!rawLine.includes(rel)) continue;
      if (!rawLine.trim().startsWith('-')) continue;
      const claimText = claimTextFromTimelineLine(rawLine);
      if (!claimText) continue;
      const existing = db.prepare('SELECT id FROM claims WHERE wiki_slug = ? AND claim_text = ?').get(slug, claimText) as any;
      const claimId = existing ? existing.id : db.prepare('INSERT INTO claims (wiki_slug, claim_text) VALUES (?, ?)').run(slug, claimText).lastInsertRowid;
      const linkRes = db.prepare('INSERT OR IGNORE INTO claim_sources (claim_id, raw_id) VALUES (?, ?)').run(claimId, rawId);
      if (linkRes.changes > 0) inserted++;
    }
    refreshSourceCount(slug);
  }
  return inserted;
}

export function backfillClaimsFromTimelineEvent(eventId: number, externalId: string, wikiFiles: string[]): number {
  const marker = `event:${externalId}`;
  let inserted = 0;
  for (const wikiFile of wikiFiles) {
    const slug = path.relative(PATHS.wiki, wikiFile).replace(/\.md$/, '').replace(/\\/g, '/');
    if (!db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug)) continue;
    const timeline = readTimeline(wikiFile);
    for (const rawLine of timeline.split('\n')) {
      if (!rawLine.includes(marker)) continue;
      if (!rawLine.trim().startsWith('-')) continue;
      const claimText = claimTextFromTimelineLine(rawLine);
      if (!claimText) continue;
      const existing = db.prepare('SELECT id FROM claims WHERE wiki_slug = ? AND claim_text = ?').get(slug, claimText) as any;
      const claimId = existing ? existing.id : db.prepare('INSERT INTO claims (wiki_slug, claim_text) VALUES (?, ?)').run(slug, claimText).lastInsertRowid;
      const linkRes = db.prepare('INSERT OR IGNORE INTO claim_sources_event (claim_id, event_id) VALUES (?, ?)').run(claimId, eventId);
      if (linkRes.changes > 0) inserted++;
    }
    refreshSourceCount(slug);
  }
  return inserted;
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

  return Array.from(new Set(terms)).join(' OR ');
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

  const hasEmbeddedChunks = (db.prepare(
    `SELECT 1 FROM chunks WHERE embedding IS NOT NULL LIMIT 1`
  ).get() as unknown) !== null;
  const queryEmbedding = hasEmbeddedChunks ? await embed(query) : null;

  // FTS runs over the wiki search_index. Skip only when source_types is set
  // and 'wiki' is not among them; project filters don't apply to wiki pages.
  const wikiExcluded = sourceTypes !== null && !sourceTypes.includes('wiki');
  const ftsResults: any[] = wikiExcluded
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
      // Wiki chunks are compiled truth — always include unless source_types
      // explicitly excludes 'wiki'. Raw chunks are filtered by source/project.
      const includeWiki = !sourceTypes || sourceTypes.includes('wiki');
      if (includeWiki) {
        sql += ` AND (c.owner_type = 'wiki' OR (c.owner_type = 'raw'`;
        if (sourceTypes) {
          sql += ` AND r.source_type IN (${sourceTypes.filter(t => t !== 'wiki').map(() => '?').join(',')})`;
          params.push(...sourceTypes.filter(t => t !== 'wiki'));
        }
        if (projects) {
          sql += ` AND r.project IN (${projects.map(() => '?').join(',')})`;
          params.push(...projects);
        }
        sql += `))`;
      } else {
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
  // v10 surface (still reported for back-compat; rip candidates).
  const totalChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
  const embeddedChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks WHERE embedding IS NOT NULL').get() as any).c;
  const pages = (db.prepare('SELECT COUNT(*) as c FROM wiki_pages').get() as any).c;
  const raws = (db.prepare('SELECT COUNT(*) as c FROM raw_entries').get() as any).c;
  const links = (db.prepare('SELECT COUNT(*) as c FROM wiki_links').get() as any).c;
  const claims = (db.prepare('SELECT COUNT(*) as c FROM claims').get() as any).c;
  const avgSource = (db.prepare('SELECT AVG(source_count) as a FROM wiki_pages').get() as any).a || 0;

  // v11 surface (authoritative for artifacts + narrative chunks).
  const artifactsTotal    = (db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as any).c;
  const artifactsActive   = (db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE status = 'active'").get() as any).c;
  const chunksVirtualTotal   = (db.prepare('SELECT COUNT(*) as c FROM chunks_virtual').get() as any).c;
  const chunksVirtualPending = (db.prepare('SELECT COUNT(*) as c FROM chunks_virtual WHERE processed = 0').get() as any).c;
  const rawEventsTotal = (db.prepare('SELECT COUNT(*) as c FROM raw_events').get() as any).c;
  const artifactsByType = db.prepare(
    "SELECT type, COUNT(*) as c FROM artifacts WHERE status = 'active' GROUP BY type ORDER BY c DESC"
  ).all() as any[];

  return {
    version,
    pages,
    raws,
    links,
    claims,
    totalChunks,
    embeddedChunks,
    avgSource: Number(avgSource.toFixed(2)),
    artifactsTotal,
    artifactsActive,
    artifactsByType: artifactsByType.map(r => ({ type: r.type, count: r.c })),
    chunksVirtualTotal,
    chunksVirtualPending,
    rawEventsTotal,
  };
}

export function getProjects(): string[] {
  // Union across v11 (artifacts, raw_events) and v10 (raw_entries) surfaces.
  const rows = db.prepare(`
    SELECT DISTINCT project FROM raw_entries WHERE project IS NOT NULL
    UNION
    SELECT DISTINCT project FROM raw_events  WHERE project IS NOT NULL
    UNION
    SELECT DISTINCT project FROM artifacts   WHERE project IS NOT NULL
    ORDER BY project ASC
  `).all() as any[];
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

export async function runGeminiInteractive(prompt: string, yolo: boolean = false) {
  const args = yolo ? ['--yolo', `-i=${prompt}`] : [`-i=${prompt}`];
  try {
    const proc = Bun.spawn(['gemini', ...args], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exit = await proc.exited;
    return { status: exit || 0 };
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
    const content = fs.readFileSync(wikiPath(p.slug), 'utf-8');
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

// --- v11: atomic artifacts, virtual chunks, safe backup ---

import { FILTER_VERSION, filterMechanical } from './narrative';

export type ArtifactSource = {
  source_raw_id?: number | null;
  source_event_id?: number | null;
  span_start?: number | null;
  span_end?: number | null;
};

export type ArtifactInput = {
  project: string;
  type: string;
  idempotency_key: string;
  data: Record<string, unknown>;
  sources?: ArtifactSource[];
};

export type ArtifactUpsertResult = { id: number; created: boolean };

export type ArtifactRow = {
  id: number;
  project: string;
  type: string;
  data: Record<string, unknown>;
  idempotency_key: string;
  superseded_by: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

function rowToArtifact(row: any): ArtifactRow {
  return {
    id: row.id,
    project: row.project,
    type: row.type,
    data: JSON.parse(row.data),
    idempotency_key: row.idempotency_key,
    superseded_by: row.superseded_by,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function syncArtifactFts(id: number, project: string, type: string, data: Record<string, unknown>) {
  // Minimal projection: concat string fields into one searchable blob.
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === 'string') parts.push(v);
    else parts.push(JSON.stringify(v));
  }
  const text = parts.join(' ');
  try {
    db.prepare(`DELETE FROM artifacts_fts WHERE artifact_id = ?`).run(id);
    db.prepare(`INSERT INTO artifacts_fts (artifact_id, project, type, text) VALUES (?, ?, ?, ?)`)
      .run(id, project, type, text);
  } catch (e) { /* FTS optional */ }
}

function insertSources(artifactId: number, sources: ArtifactSource[] | undefined) {
  if (!sources || sources.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO artifact_sources (artifact_id, source_raw_id, source_event_id, span_start, span_end)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const s of sources) {
    stmt.run(
      artifactId,
      s.source_raw_id ?? null,
      s.source_event_id ?? null,
      s.span_start ?? null,
      s.span_end ?? null,
    );
  }
}

function upsertArtifactInner(input: ArtifactInput): ArtifactUpsertResult {
  const dataJson = JSON.stringify(input.data);
  const existing = db.prepare(
    `SELECT id FROM artifacts WHERE project = ? AND type = ? AND idempotency_key = ?`
  ).get(input.project, input.type, input.idempotency_key) as { id: number } | undefined;

  if (existing) {
    insertSources(existing.id, input.sources);
    db.prepare(`UPDATE artifacts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
    return { id: existing.id, created: false };
  }

  const result = db.prepare(
    `INSERT INTO artifacts (project, type, data, idempotency_key) VALUES (?, ?, ?, ?)`
  ).run(input.project, input.type, dataJson, input.idempotency_key);
  const id = Number(result.lastInsertRowid);
  insertSources(id, input.sources);
  syncArtifactFts(id, input.project, input.type, input.data);
  return { id, created: true };
}

export function upsertArtifact(input: ArtifactInput): ArtifactUpsertResult {
  return db.transaction(() => upsertArtifactInner(input))();
}

export function batchArtifacts(inputs: ArtifactInput[]): ArtifactUpsertResult[] {
  const tx = db.transaction((items: ArtifactInput[]) => items.map(upsertArtifactInner));
  return tx(inputs);
}

export type ArtifactListOpts = {
  project?: string | null;
  type?: string | null;
  status?: string | null;
  limit?: number;
};

export function listArtifacts(opts: ArtifactListOpts = {}): ArtifactRow[] {
  const clauses: string[] = [];
  const params: any[] = [];
  if (opts.project) { clauses.push('project = ?'); params.push(opts.project); }
  if (opts.type)    { clauses.push('type = ?');    params.push(opts.type); }
  if (opts.status)  { clauses.push('status = ?');  params.push(opts.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 200;
  const rows = db.prepare(
    `SELECT * FROM artifacts ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit) as any[];
  return rows.map(rowToArtifact);
}

export type ArtifactKey = {
  id: number;
  type: string;
  idempotency_key: string;
  summary: string;
};

// Field order mirrors the viewer's summarize() — try the canonical "core field"
// for each type, fall back to a JSON snippet.
const SUMMARY_FIELDS = [
  'statement', 'symptom', 'problem', 'pattern', 'note',
  'technology', 'area', 'error_message', 'previous_belief',
];

function summarizeArtifactData(data: Record<string, unknown>, cap = 120): string {
  for (const f of SUMMARY_FIELDS) {
    const v = (data as any)[f];
    if (typeof v === 'string' && v.trim()) {
      return v.length > cap ? v.slice(0, cap - 1).trimEnd() + '…' : v;
    }
  }
  const fallback = JSON.stringify(data);
  return fallback.length > cap ? fallback.slice(0, cap - 1) + '…' : fallback;
}

export function listArtifactKeys(opts: ArtifactListOpts = {}): ArtifactKey[] {
  return listArtifacts(opts).map(a => ({
    id: a.id,
    type: a.type,
    idempotency_key: a.idempotency_key,
    summary: summarizeArtifactData(a.data),
  }));
}

export type ArtifactSearchOpts = {
  project?: string | null;
  type?: string | null;
  status?: string | null;
  limit?: number;
};

export type ArtifactSearchResult = ArtifactRow & { snippet: string; rank: number };

// FTS over artifacts_fts. Tokenizes the query (so "virtual chunks" matches both
// words anywhere, not just as a phrase) and quote-escapes each token so fts5
// treats punctuation like ':' and '-' literally rather than as operators.
export function searchArtifacts(query: string, opts: ArtifactSearchOpts = {}): ArtifactSearchResult[] {
  const raw = (query || '').trim();
  if (!raw) return [];
  const tokens = raw.split(/\s+/)
    .map(t => t.replace(/[^\w\u00C0-\uFFFF-]/g, ''))
    .filter(Boolean)
    .map(t => '"' + t.replace(/"/g, '""') + '"');
  if (tokens.length === 0) return [];
  const safe = tokens.join(' '); // fts5 default operator is AND between tokens

  const clauses: string[] = [`artifacts_fts MATCH ?`];
  const params: any[] = [safe];
  if (opts.project) { clauses.push(`artifacts_fts.project = ?`); params.push(opts.project); }
  if (opts.type)    { clauses.push(`artifacts_fts.type = ?`);    params.push(opts.type); }
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
  const statusFilter = opts.status && opts.status !== 'all' ? opts.status : null;

  const sql = `
    SELECT a.*, snippet(artifacts_fts, 3, '[', ']', ' … ', 12) as snippet, artifacts_fts.rank as rank
    FROM artifacts_fts
    JOIN artifacts a ON a.id = artifacts_fts.artifact_id
    WHERE ${clauses.join(' AND ')}
    ${statusFilter ? `AND a.status = ?` : ''}
    ORDER BY rank
    LIMIT ?
  `;
  if (statusFilter) params.push(statusFilter);
  params.push(limit);

  let rows: any[];
  try { rows = db.prepare(sql).all(...params) as any[]; } catch (e) { return []; }
  return rows.map(r => ({
    ...rowToArtifact(r),
    snippet: r.snippet || '',
    rank: r.rank,
  }));
}

export function supersedeArtifact(oldId: number, newId: number): void {
  const old = db.prepare(`SELECT id FROM artifacts WHERE id = ?`).get(oldId);
  const nu  = db.prepare(`SELECT id FROM artifacts WHERE id = ?`).get(newId);
  if (!old) throw new Error(`artifact ${oldId} not found`);
  if (!nu)  throw new Error(`artifact ${newId} not found`);
  db.prepare(
    `UPDATE artifacts SET superseded_by = ?, status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(newId, oldId);
}

export function bumpCorrection(id: number): ArtifactRow {
  const row = db.prepare(`SELECT * FROM artifacts WHERE id = ? AND type = 'correction'`).get(id) as any;
  if (!row) throw new Error(`correction artifact ${id} not found`);
  const data = JSON.parse(row.data);
  data.count = (typeof data.count === 'number' ? data.count : 0) + 1;
  data.last_seen = new Date().toISOString();
  db.prepare(
    `UPDATE artifacts SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(JSON.stringify(data), id);
  syncArtifactFts(id, row.project, row.type, data);
  return rowToArtifact({ ...row, data: JSON.stringify(data) });
}

// --- v12: briefing surface (session-start preamble) ---

export type BriefingData = {
  project: string;
  generated_at: string;
  latest_raw_event_at: string | null;
  health: {
    schema_version: number;
    artifacts_active: number;
    artifacts_by_type: Array<{ type: string; count: number }>;
    chunks_processed: number;
    chunks_total: number;
    raw_events: number;
  };
  active_agents: ActiveAgentRow[];
  intents: ArtifactRow[];
  bugs: ArtifactRow[];
  decisions: ArtifactRow[];
  frictions: ArtifactRow[];
  corrections: ArtifactRow[];
  todos: ArtifactRow[];
};

const HORIZON_ORDER: Record<string, number> = { project: 0, milestone: 1, session: 2 };
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const FREQ_ORDER: Record<string, number> = { Constant: 0, High: 1, Occasional: 2, Once: 3 };

export function getBrief(project: string): BriefingData {
  const generated_at = new Date().toISOString();
  const schemaVersion = (db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any)?.version || 0;

  const artifactsActive = (db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE project = ? AND status = 'active'").get(project) as any).c;
  const artifactsByTypeRows = db.prepare(
    "SELECT type, COUNT(*) as c FROM artifacts WHERE project = ? AND status = 'active' GROUP BY type ORDER BY c DESC"
  ).all(project) as any[];
  const chunksTotal = (db.prepare('SELECT COUNT(*) as c FROM chunks_virtual WHERE project = ?').get(project) as any).c;
  const chunksProcessed = (db.prepare("SELECT COUNT(*) as c FROM chunks_virtual WHERE project = ? AND processed = 1").get(project) as any).c;
  const rawEvents = (db.prepare('SELECT COUNT(*) as c FROM raw_events WHERE project = ?').get(project) as any).c;
  const latestRawEventAt = (db.prepare("SELECT created_at FROM raw_events WHERE project = ? ORDER BY created_at DESC LIMIT 1").get(project) as any)?.created_at ?? null;

  const active_agents = getActiveAgents({ maxAgeSeconds: 300 });

  const intentsAll = listArtifacts({ project, type: 'intent', status: 'active', limit: 50 });
  const intents = intentsAll.sort((a, b) => {
    const ah = (a.data as any).horizon ?? 'project';
    const bh = (b.data as any).horizon ?? 'project';
    return (HORIZON_ORDER[ah] ?? 99) - (HORIZON_ORDER[bh] ?? 99);
  }).slice(0, 10);

  const bugsAll = listArtifacts({ project, type: 'bug', status: 'active', limit: 100 });
  const bugs = bugsAll.filter(b => {
    const s = (b.data as any).status;
    return s !== 'fixed' && s !== 'wontfix';
  }).sort((a, b) => {
    const av = SEVERITY_ORDER[(a.data as any).severity ?? 'low'] ?? 3;
    const bv = SEVERITY_ORDER[(b.data as any).severity ?? 'low'] ?? 3;
    return av - bv;
  });

  const decisions = listArtifacts({ project, type: 'decision', status: 'active', limit: 10 });

  const frictionsAll = listArtifacts({ project, type: 'friction', status: 'active', limit: 50 });
  const frictions = frictionsAll.sort((a, b) => {
    const af = (a.data as any).frequency_estimate ?? 'Once';
    const bf = (b.data as any).frequency_estimate ?? 'Once';
    return (FREQ_ORDER[af] ?? 99) - (FREQ_ORDER[bf] ?? 99);
  }).slice(0, 8);

  const threshold = parseInt(process.env.MT_BRIEF_CORRECTION_THRESHOLD || '3', 10);
  const correctionsAll = listArtifacts({ project, type: 'correction', status: 'active', limit: 100 });
  const corrections = correctionsAll
    .filter(c => Number((c.data as any).count ?? 0) >= threshold)
    .sort((a, b) => Number((b.data as any).count ?? 0) - Number((a.data as any).count ?? 0));

  const todos = listArtifacts({ project, type: 'todo', status: 'active', limit: 10 });

  return {
    project,
    generated_at,
    latest_raw_event_at: latestRawEventAt,
    health: {
      schema_version: schemaVersion,
      artifacts_active: artifactsActive,
      artifacts_by_type: artifactsByTypeRows.map(r => ({ type: r.type, count: r.c })),
      chunks_processed: chunksProcessed,
      chunks_total: chunksTotal,
      raw_events: rawEvents,
    },
    active_agents,
    intents,
    bugs,
    decisions,
    frictions,
    corrections,
    todos,
  };
}

function truncateSnippet(s: string, cap: number): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= cap) return collapsed;
  return collapsed.slice(0, cap - 1).trimEnd() + '…';
}

export function renderBrief(data: BriefingData): string {
  if (data.health.artifacts_active === 0 && data.health.raw_events === 0) {
    return `# ${data.project} briefing — no data yet.\n`;
  }

  const parts: string[] = [];
  parts.push(`# ${data.project} project briefing — ${data.generated_at}`);
  if (data.latest_raw_event_at) parts.push(`_Latest raw event: ${data.latest_raw_event_at}_`);

  parts.push('');
  parts.push('## Health');
  parts.push(`- Schema: v${data.health.schema_version}`);
  const typeBreakdown = data.health.artifacts_by_type.map(t => `${t.count} ${t.type}`).join(', ');
  parts.push(`- Artifacts: ${data.health.artifacts_active} active${typeBreakdown ? ` (${typeBreakdown})` : ''}`);
  parts.push(`- Chunks: ${data.health.chunks_processed}/${data.health.chunks_total}`);
  parts.push(`- Raw events: ${data.health.raw_events}`);

  parts.push('');
  parts.push('## Active agents');
  if (data.active_agents.length === 0) {
    parts.push('No agents active in last 5 minutes.');
  } else {
    for (const a of data.active_agents) {
      const who = a.participant_id || a.provider;
      const age = formatRelativeTime(a.seconds_ago);
      const snippet = a.last_user_snippet ? truncateSnippet(a.last_user_snippet, 100) : null;
      const doing = snippet ? ` · doing: ${snippet}` : '';
      parts.push(`- ${who} · ${a.project} · ${age}${doing}`);
    }
  }

  if (data.intents.length > 0) {
    parts.push('');
    parts.push(`## Intents (${data.intents.length})`);
    for (const i of data.intents) {
      const d = i.data as any;
      const horizon = d.horizon ?? 'project';
      const stmt = d.statement ?? '';
      const alignment = d.alignment_check ? ` (alignment: ${d.alignment_check})` : '';
      parts.push(`- [${horizon}] ${stmt}${alignment}`);
    }
  }

  if (data.bugs.length > 0) {
    parts.push('');
    parts.push(`## Open bugs (${data.bugs.length})`);
    for (const b of data.bugs) {
      const d = b.data as any;
      const sev = d.severity ?? 'low';
      const sym = d.symptom ?? '';
      const ctx = d.context ? ` (context: ${d.context})` : '';
      parts.push(`- [${sev}] ${sym}${ctx}`);
    }
  }

  if (data.decisions.length > 0) {
    parts.push('');
    parts.push(`## Recent decisions (last ${data.decisions.length})`);
    for (const d of data.decisions) {
      const dd = d.data as any;
      const stmt = dd.statement ?? '';
      const rat = dd.rationale ? ` — ${dd.rationale}` : '';
      const area = dd.area ? ` [${dd.area}]` : '';
      parts.push(`- ${stmt}${rat}${area}`);
    }
  }

  if (data.frictions.length > 0) {
    parts.push('');
    parts.push('## Recurring frictions');
    for (const f of data.frictions) {
      const d = f.data as any;
      const pat = d.pattern ?? '';
      const freq = d.frequency_estimate ?? '';
      const first = d.first_seen ? `, first_seen ${d.first_seen}` : '';
      parts.push(`- ${pat} (${freq}${first})`);
    }
  }

  if (data.corrections.length > 0) {
    parts.push('');
    parts.push('## Corrections above threshold');
    for (const c of data.corrections) {
      const d = c.data as any;
      parts.push(`- was: ${d.previous_belief ?? ''}; now: ${d.corrected_view ?? ''} (seen ${d.count}×, last ${d.last_seen})`);
    }
  }

  if (data.todos.length > 0) {
    parts.push('');
    parts.push(`## Recent todos (${data.todos.length})`);
    for (const t of data.todos) {
      const d = t.data as any;
      const eff = d.effort ?? 'medium';
      const stmt = d.statement ?? '';
      const area = d.area ? ` [${d.area}]` : '';
      parts.push(`- [${eff}] ${stmt}${area}`);
    }
  }

  return parts.join('\n') + '\n';
}

export type ChunkVirtualInsert = {
  project: string;
  source_event_id: number;
  chunk_index: number;
  chunk_total: number;
  segment_start: number;
  segment_end: number;
};

export function insertChunkVirtual(c: ChunkVirtualInsert): number {
  const result = db.prepare(
    `INSERT INTO chunks_virtual
     (project, source_event_id, chunk_index, chunk_total, segment_start, segment_end, filter_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(c.project, c.source_event_id, c.chunk_index, c.chunk_total, c.segment_start, c.segment_end, FILTER_VERSION);
  return Number(result.lastInsertRowid);
}

export type ChunkRead = {
  id: number;
  project: string;
  source_event_id: number;
  chunk_index: number;
  chunk_total: number;
  filter_version_stored: number;
  filter_version_current: number;
  content: string;
};

export function readChunk(id: number): ChunkRead {
  const row = db.prepare(`SELECT * FROM chunks_virtual WHERE id = ?`).get(id) as any;
  if (!row) throw new Error(`chunks_virtual ${id} not found`);
  const evt = db.prepare(`SELECT content FROM raw_events WHERE id = ?`).get(row.source_event_id) as any;
  if (!evt) throw new Error(`raw_events ${row.source_event_id} not found`);
  const raw: string = evt.content;
  const slice = raw.slice(row.segment_start, row.segment_end);
  const content = filterMechanical(slice);
  return {
    id: row.id,
    project: row.project,
    source_event_id: row.source_event_id,
    chunk_index: row.chunk_index,
    chunk_total: row.chunk_total,
    filter_version_stored: row.filter_version,
    filter_version_current: FILTER_VERSION,
    content,
  };
}

export function queueChunks(project: string | null, limit: number = 200) {
  const clauses = ['processed = 0'];
  const params: any[] = [];
  if (project) { clauses.push('project = ?'); params.push(project); }
  const rows = db.prepare(
    `SELECT id, project, source_event_id, chunk_index, chunk_total, filter_version, created_at
     FROM chunks_virtual
     WHERE ${clauses.join(' AND ')}
     ORDER BY id ASC
     LIMIT ?`
  ).all(...params, limit) as any[];
  return rows;
}

export function markChunkProcessed(id: number): void {
  const row = db.prepare(`SELECT id FROM chunks_virtual WHERE id = ?`).get(id);
  if (!row) throw new Error(`chunks_virtual ${id} not found`);
  db.prepare(`UPDATE chunks_virtual SET processed = 1 WHERE id = ?`).run(id);
}

// --- v11.1 / v11.2: importer idempotency ---
//
// v11.1: Stored `content_hash` to fix silent data loss when growing sessions
// hit `INSERT OR IGNORE` on a stable external_id.
//
// v11.2 hardens this in three ways (after audit):
//   (a) Runs the whole upsert inside a single `db.transaction` so partial
//       failures roll back — previously a mid-function throw could leave
//       raw_events, chunks_virtual, and events_fts out of sync.
//   (b) Updates `project` and `source_type` on raw_events (not just the FTS
//       projection), so a classification change on the same external_id can't
//       leave the base row disagreeing with events_fts.
//   (c) Resets `processed = 0` on update. Previously a row that had already
//       crossed into the v10 wiki-ingest path (`processed = 1`) would be
//       stranded: chunker skips it, `brain ingest-event` short-circuits.
//
// artifact_sources rows are still preserved on update — spans into the old
// content remain valid for append-growth (the vendor pattern).

export type RawEventInput = {
  source_type: string;
  project: string;
  external_id: string;
  timestamp: string;
  content: string;
  title?: string | null;
  participants?: string | null;
  metadata?: string | null;
};

export type UpsertRawEventResult = 'inserted' | 'updated' | 'unchanged';

function upsertRawEventInner(e: RawEventInput): UpsertRawEventResult {
  const content_hash = getHash(e.content);
  const existing = db.prepare(
    `SELECT id, content_hash FROM raw_events WHERE external_id = ?`
  ).get(e.external_id) as { id: number; content_hash: string | null } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO raw_events
         (source_type, project, external_id, timestamp, content, title,
          participants, metadata, processed, deduped, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`
    ).run(
      e.source_type, e.project, e.external_id, e.timestamp, e.content,
      e.title ?? null, e.participants ?? null, e.metadata ?? null, content_hash,
    );
    db.prepare(
      `INSERT INTO events_fts (external_id, project, source_type, title, content)
       VALUES (?, ?, ?, ?, ?)`
    ).run(e.external_id, e.project, e.source_type, e.title ?? '', e.content);
    return 'inserted';
  }

  // Back-compat: existing rows before v11.1 have content_hash = NULL.
  // Compute + store the hash; if content really matches, return 'unchanged'
  // after writing just the hash (no chunks_virtual clear, no processed reset).
  if (!existing.content_hash) {
    const current = db.prepare(`SELECT content FROM raw_events WHERE id = ?`).get(existing.id) as any;
    if (current && current.content === e.content) {
      db.prepare(`UPDATE raw_events SET content_hash = ? WHERE id = ?`).run(content_hash, existing.id);
      return 'unchanged';
    }
  } else if (existing.content_hash === content_hash) {
    return 'unchanged';
  }

  // Hash differs — re-classify + reset pipeline state. processed=0 so the
  // chunker/ingester sees this as fresh work.
  db.prepare(
    `UPDATE raw_events SET
       content = ?, title = ?, timestamp = ?, metadata = ?,
       source_type = ?, project = ?,
       content_hash = ?, chunked = 0, processed = 0
     WHERE id = ?`
  ).run(
    e.content, e.title ?? null, e.timestamp, e.metadata ?? null,
    e.source_type, e.project,
    content_hash, existing.id,
  );

  // Clear stale narrative chunks so the chunker re-emits against new content.
  db.prepare(`DELETE FROM chunks_virtual WHERE source_event_id = ?`).run(existing.id);

  // Refresh events_fts projection — if this throws, tx rolls back the UPDATE.
  db.prepare(`DELETE FROM events_fts WHERE external_id = ?`).run(e.external_id);
  db.prepare(
    `INSERT INTO events_fts (external_id, project, source_type, title, content)
     VALUES (?, ?, ?, ?, ?)`
  ).run(e.external_id, e.project, e.source_type, e.title ?? '', e.content);

  return 'updated';
}

export function upsertRawEvent(e: RawEventInput): UpsertRawEventResult {
  return db.transaction(() => upsertRawEventInner(e))();
}

export function vacuumBackup(target: string): void {
  // Absolute path required by VACUUM INTO.
  const abs = path.isAbsolute(target) ? target : path.resolve(target);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) { /* best-effort checkpoint */ }
  // Parameterize path through a literal; VACUUM INTO only accepts string literals.
  const escaped = abs.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
}

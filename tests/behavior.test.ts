/**
 * Behavior tests for Mnemonic51.
 *
 * These tests exercise real CLI commands and API responses against a fresh
 * temp `MT_BRAIN_ROOT` per test. No mocking of core logic — we drive the same
 * entry points a user does. Gemini synthesis calls ARE mocked via a PATH shim
 * so we don't hit external services.
 *
 * Run with: `bun test`
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const BRAIN_TS = path.join(REPO, 'src', 'brain.ts');
const API_TS   = path.join(REPO, 'src', 'api.ts');
const IMPORT_CLAUDE_TS = path.join(REPO, 'scripts', 'import-claude.ts');
const CHUNK_EVENTS_TS = path.join(REPO, 'scripts', 'chunk-events.ts');
const REPAIR_NOTE_PROVENANCE_TS = path.join(REPO, 'scripts', 'repair-note-provenance.ts');

let tmpRoot: string;
let shimDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'wiki'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'meta', 'skills'), { recursive: true });
  // Seed minimum meta fixtures needed by the process / ingest-event commands.
  fs.copyFileSync(path.join(REPO, 'meta', 'schema.md'), path.join(tmpRoot, 'meta', 'schema.md'));
  fs.copyFileSync(path.join(REPO, 'meta', 'skills', 'ingest.md'), path.join(tmpRoot, 'meta', 'skills', 'ingest.md'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (shimDir) { try { fs.rmSync(shimDir, { recursive: true, force: true }); } catch {} shimDir = ''; }
});

function openDb(): Database {
  return new Database(path.join(tmpRoot, 'meta', 'brain.db'));
}

async function brain(args: string[], extraEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', BRAIN_TS, ...args], {
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code || 0, stdout, stderr };
}

function makeShim(script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-shim-'));
  const bin = path.join(dir, 'gemini');
  fs.writeFileSync(bin, script);
  fs.chmodSync(bin, 0o755);
  return dir;
}

function writeWikiPage(slug: string, opts: { title?: string; summary?: string; timeline?: string } = {}) {
  const title = opts.title ?? slug;
  const body = `---
title: ${title}
slug: ${slug}
aliases: []
tags: [concept]
type: concept
confidence: 0.7
mentions: 1
tier: 3
status: active
created_at: 2026-04-18
updated_at: 2026-04-18
source_count: 0
---

# ${title}

## Summary
${opts.summary ?? 'Test summary.'}

## Cross-References

---
<!-- TIMELINE: append-only below this line -->
${opts.timeline ?? ''}
`;
  fs.writeFileSync(path.join(tmpRoot, 'wiki', `${slug}.md`), body);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate test port')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function startApi(): Promise<{ base: string; stop: () => Promise<void> }> {
  const testPort = await getFreePort();
  const api = Bun.spawn(['bun', API_TS], {
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_PORT: String(testPort) },
    stdout: 'pipe', stderr: 'pipe',
  });
  const base = `http://localhost:${testPort}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/stats`);
      if (r.ok) { ready = true; break; }
    } catch {}
    if (api.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) {
    api.kill();
    const stderr = await new Response(api.stderr).text();
    throw new Error(stderr || `API did not start on ${base}`);
  }
  return {
    base,
    stop: async () => {
      api.kill();
      await api.exited;
    },
  };
}

function seedNote(project: string, sourceChunkId: number, summary: string, artifacts: any[]): number {
  const db = openDb();
  try {
    const noteId = Number(db.prepare(
      `INSERT INTO notes (project, source_chunk_id, summary, artifacts)
       VALUES (?, ?, ?, ?)`
    ).run(project, sourceChunkId, summary, JSON.stringify(artifacts)).lastInsertRowid);
    const fts = db.prepare(
      `INSERT INTO notes_fts (note_id, project, artifact_index, summary, title, body)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    artifacts.forEach((artifact, index) => {
      fts.run(noteId, project, index, summary, artifact.title || '', artifact.body || '');
    });
    return noteId;
  } finally {
    db.close();
  }
}

// ---------- SCHEMA ----------

describe.serial('schema migration', () => {
  test.serial('fresh root bootstraps to v16', async () => {
    await brain(['queue']);
    const db = openDb();
    const version = (db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any).version;
    expect(version).toBe(16);
    const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const name of [
      'raw_entries', 'raw_events', 'wiki_pages', 'claims', 'claim_sources', 'claim_sources_event', 'import_state',
      'artifacts', 'artifact_sources', 'chunks_virtual', 'session_index', 'session_message_links', 'session_usage', 'session_events',
      'notes', 'note_title_hashes', 'notes_fts', 'schema_migrations',
    ]) {
      expect(tbls).toContain(name);
    }
    // v10 column is still there
    const evCols = db.prepare("PRAGMA table_info(raw_events)").all().map((c: any) => c.name);
    expect(evCols).toContain('chunked');
    // v11 columns on artifacts
    const artCols = db.prepare("PRAGMA table_info(artifacts)").all().map((c: any) => c.name);
    for (const name of ['id', 'project', 'type', 'data', 'idempotency_key', 'superseded_by', 'status']) {
      expect(artCols).toContain(name);
    }
    const cvCols = db.prepare("PRAGMA table_info(chunks_virtual)").all().map((c: any) => c.name);
    for (const name of ['source_event_id', 'segment_start', 'segment_end', 'filter_version', 'processed']) {
      expect(cvCols).toContain(name);
    }
    const sessionCols = db.prepare("PRAGMA table_info(session_index)").all().map((c: any) => c.name);
    for (const name of ['vendor', 'session_id', 'participant_id', 'project_role', 'state']) {
      expect(sessionCols).toContain(name);
    }
    const usageCols = db.prepare("PRAGMA table_info(session_usage)").all().map((c: any) => c.name);
    for (const name of ['vendor', 'session_id', 'participant_id', 'input_tokens', 'cost_breakdown', 'pricing_source']) {
      expect(usageCols).toContain(name);
    }
    const eventCols = db.prepare("PRAGMA table_info(session_events)").all().map((c: any) => c.name);
    for (const name of ['id', 'event_type', 'vendor', 'session_id', 'participant_id', 'project_role', 'payload']) {
      expect(eventCols).toContain(name);
    }
    const noteCols = db.prepare("PRAGMA table_info(notes)").all().map((c: any) => c.name);
    for (const name of [
      'id', 'project', 'source_chunk_id', 'summary', 'artifacts', 'embedding',
      'source_event_id', 'source_external_id', 'source_segment_start', 'source_segment_end',
      'source_filter_version', 'source_span_hash',
    ]) {
      expect(noteCols).toContain(name);
    }
    const noteHashCols = db.prepare("PRAGMA table_info(note_title_hashes)").all().map((c: any) => c.name);
    for (const name of ['note_id', 'artifact_index', 'title_hash', 'project']) {
      expect(noteHashCols).toContain(name);
    }
    const noteFks = db.prepare("PRAGMA foreign_key_list(notes)").all() as any[];
    expect(noteFks.some(fk => fk.from === 'source_chunk_id')).toBe(false);
    db.close();
  });

  test.serial('self-heals stale v15 notes source_chunk_id foreign key without losing data', async () => {
    const db = openDb();
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);
      INSERT INTO schema_version (id, version) VALUES (1, 15);
      CREATE TABLE notes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project         TEXT NOT NULL,
        source_chunk_id INTEGER NOT NULL,
        summary         TEXT NOT NULL,
        artifacts       TEXT NOT NULL,
        embedding       BLOB,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_chunk_id) REFERENCES chunks_virtual(id),
        UNIQUE(project, source_chunk_id)
      );
      CREATE TABLE note_title_hashes (
        note_id        INTEGER NOT NULL,
        artifact_index INTEGER NOT NULL,
        title_hash     TEXT NOT NULL,
        project        TEXT NOT NULL,
        PRIMARY KEY (note_id, artifact_index),
        UNIQUE (project, title_hash),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
      );
      INSERT INTO notes (id, project, source_chunk_id, summary, artifacts, created_at)
      VALUES (7, 'mm', 42, 'Stale note summary', '[{"title":"Stale FK Note","body":"Survives migration."}]', '2026-05-06T00:00:00Z');
      INSERT INTO note_title_hashes (note_id, artifact_index, title_hash, project)
      VALUES (7, 0, 'hash-stale', 'mm');
    `);
    db.close();

    const res = await brain(['queue']);
    expect(res.code).toBe(0);

    const healed = openDb();
    try {
      const fks = healed.prepare('PRAGMA foreign_key_list(notes)').all() as any[];
      expect(fks.some(fk => fk.from === 'source_chunk_id')).toBe(false);
      const note = healed.prepare('SELECT id, project, source_chunk_id, summary, artifacts FROM notes WHERE id = 7').get() as any;
      expect(note.project).toBe('mm');
      expect(note.source_chunk_id).toBe(42);
      expect(note.summary).toBe('Stale note summary');
      expect(JSON.parse(note.artifacts)[0].title).toBe('Stale FK Note');
      const hash = healed.prepare('SELECT title_hash FROM note_title_hashes WHERE note_id = 7').get() as any;
      expect(hash.title_hash).toBe('hash-stale');
      const fts = healed.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH 'survives'").all() as any[];
      expect(fts.map(r => r.note_id)).toContain(7);
    } finally {
      healed.close();
    }
  });

  test.serial('v16 migration snapshots provenance for notes whose source chunks still exist', async () => {
    await brain(['queue']);
    const db = openDb();
    const content = 'User: migration source\n\nAssistant: migration answer';
    const eventId = Number(db.prepare(
      `INSERT INTO raw_events (source_type, project, external_id, timestamp, content)
       VALUES ('llm_chat', 'mm', 'event:v16-migration', '2026-09-25T00:00:00Z', ?)`
    ).run(content).lastInsertRowid);
    const chunkId = Number(db.prepare(
      `INSERT INTO chunks_virtual
       (project, source_event_id, chunk_index, chunk_total, segment_start, segment_end, filter_version)
       VALUES ('mm', ?, 1, 1, 0, ?, 2)`
    ).run(eventId, content.length).lastInsertRowid);
    const noteId = Number(db.prepare(
      `INSERT INTO notes (project, source_chunk_id, summary, artifacts)
       VALUES ('mm', ?, 'Migration note.', '[{"title":"Migration Note","body":"Body."}]')`
    ).run(chunkId).lastInsertRowid);
    db.prepare('UPDATE schema_version SET version = 15 WHERE id = 1').run();
    db.close();

    const migrated = await brain(['queue']);
    expect(migrated.code).toBe(0);
    const after = openDb();
    const row = after.prepare(
      `SELECT source_event_id, source_external_id, source_segment_start, source_segment_end,
              source_filter_version, source_span_hash
       FROM notes WHERE id = ?`
    ).get(noteId) as any;
    expect(row).toMatchObject({
      source_event_id: eventId,
      source_external_id: 'event:v16-migration',
      source_segment_start: 0,
      source_segment_end: content.length,
      source_filter_version: 2,
    });
    expect(row.source_span_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((after.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any).version).toBe(16);
    after.close();
  });

  test.serial('notes FTS rebuild runs once and later initDb calls leave it untouched', async () => {
    await brain(['queue']);
    seedNote('mm', 101, 'First migration summary.', [
      { title: 'First migration artifact', body: 'Atomic rebuild alpha.' },
    ]);
    seedNote('mm', 102, 'Second migration summary.', [
      { title: 'Second migration artifact', body: 'Atomic rebuild beta.' },
    ]);

    const before = openDb();
    before.exec(`
      DELETE FROM schema_migrations
      WHERE name = '2026-09-25-notes-fts-atomic-rebuild';
      DELETE FROM notes_fts;
    `);
    before.close();

    const migrated = await brain(['queue']);
    expect(migrated.code).toBe(0);

    const afterMigration = openDb();
    expect((afterMigration.prepare('SELECT COUNT(*) AS c FROM notes_fts').get() as any).c).toBe(2);
    expect((afterMigration.prepare(
      `SELECT COUNT(*) AS c FROM schema_migrations
       WHERE name = '2026-09-25-notes-fts-atomic-rebuild'`
    ).get() as any).c).toBe(1);
    afterMigration.exec('DELETE FROM notes_fts');
    afterMigration.close();

    const repeated = await brain(['queue']);
    expect(repeated.code).toBe(0);
    const afterRepeat = openDb();
    expect((afterRepeat.prepare('SELECT COUNT(*) AS c FROM notes_fts').get() as any).c).toBe(0);
    afterRepeat.close();
  });

  test.serial('notes FTS migration rolls back the delete when a rebuild row fails', async () => {
    await brain(['queue']);
    seedNote('mm', 201, 'First rollback summary.', [
      { title: 'First rollback artifact', body: 'Must not replace the old index alone.' },
    ]);
    const rejectedNoteId = seedNote('mm', 202, 'Second rollback summary.', [
      { title: 'Second rollback artifact', body: 'Forces the simulated migration failure.' },
    ]);

    const setup = openDb();
    setup.exec(`
      DELETE FROM schema_migrations
      WHERE name = '2026-09-25-notes-fts-atomic-rebuild';
      DROP TABLE notes_fts;
      CREATE TABLE notes_fts (
        note_id INTEGER CHECK(note_id != ${rejectedNoteId}),
        project TEXT,
        artifact_index INTEGER,
        summary TEXT,
        title TEXT,
        body TEXT
      );
      INSERT INTO notes_fts (note_id, project, artifact_index, summary, title, body)
      VALUES (999, 'mm', 0, 'old complete index', 'sentinel', 'must survive rollback');
    `);
    setup.close();

    const failed = await brain(['queue']);
    expect(failed.code).not.toBe(0);

    const after = openDb();
    expect(after.prepare('SELECT note_id FROM notes_fts').all()).toEqual([{ note_id: 999 }]);
    expect((after.prepare(
      `SELECT COUNT(*) AS c FROM schema_migrations
       WHERE name = '2026-09-25-notes-fts-atomic-rebuild'`
    ).get() as any).c).toBe(0);
    after.close();
  });
});

// ---------- OPTION A: RAW RETRO-SWEEP ----------

describe.serial('brain process — Phase 1 retro-sweep', () => {
  test.serial('raw entry cited by wiki timeline gets retro-linked without LLM', async () => {
    // Seed a raw file
    const rawDir = path.join(tmpRoot, 'raw', 'docs', 'test');
    fs.mkdirSync(rawDir, { recursive: true });
    const rawPath = path.join(rawDir, 'entry.md');
    fs.writeFileSync(rawPath, '# Test Entry\n\nAdded: now\n\n---\n\nBody.\n');
    // Seed a wiki page whose timeline cites the raw path
    writeWikiPage('RetroRaw', {
      timeline: '- **2026-04-18**: Claim about RetroRaw. Source: `raw/docs/test/entry.md`',
    });
    // Rebuild so raw_entries + wiki_pages are seeded
    await brain(['index', 'rebuild']);
    // Run process — Phase 1 should retro-link without any LLM call
    const res = await brain(['process']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Retro-linked');

    const db = openDb();
    const raw = db.prepare('SELECT id, processed FROM raw_entries').get() as any;
    expect(raw.processed).toBe(1);
    const claimCount = (db.prepare('SELECT COUNT(*) as c FROM claims').get() as any).c;
    expect(claimCount).toBeGreaterThanOrEqual(1);
    const srcCount = (db.prepare('SELECT COUNT(*) as c FROM claim_sources WHERE raw_id = ?').get(raw.id) as any).c;
    expect(srcCount).toBeGreaterThanOrEqual(1);
    const pageSourceCount = (db.prepare('SELECT source_count FROM wiki_pages WHERE slug = ?').get('RetroRaw') as any).source_count;
    expect(pageSourceCount).toBe(1);
    db.close();
  });

  test.serial('raw entry with no citation stays processed=0 when LLM is unavailable', async () => {
    const rawDir = path.join(tmpRoot, 'raw', 'docs', 'test');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, 'uncited.md'), '# Uncited\n\nAdded: now\n\n---\n\nBody.\n');
    // Seed an unrelated wiki page so process has wiki to scan
    writeWikiPage('Other', { timeline: '- **2026-04-18**: Unrelated. Source: `raw/docs/test/other.md`' });
    await brain(['index', 'rebuild']);

    // Shim gemini to fail — Phase 2 skips the entry cleanly
    shimDir = makeShim('#!/bin/sh\necho "no gemini" >&2\nexit 1\n');
    const res = await brain(['process'], { PATH: `${shimDir}:${process.env.PATH}` });
    expect(res.code).toBe(0); // process itself doesn't exit non-zero on per-entry failure

    const db = openDb();
    const raw = db.prepare('SELECT processed FROM raw_entries').get() as any;
    expect(raw.processed).toBe(0); // never false-positive
    db.close();
  });
});

// ---------- OPTION A: EVENT RETRO-SWEEP ----------

describe.serial('brain process — event retro-sweep', () => {
  test.serial('event cited by wiki timeline via `event:<id>` gets retro-linked', async () => {
    await brain(['queue']); // bootstraps schema
    const db = openDb();
    // Seed a raw_event
    const res = db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed)
      VALUES ('llm_chat', 'mm', ?, datetime('now'), 'hello', 'Test Event', 0)`).run('evt-123-abc');
    const eventId = Number(res.lastInsertRowid);
    db.close();

    // Wiki page with timeline citation of event:evt-123-abc
    writeWikiPage('RetroEvent', {
      timeline: '- **2026-04-18**: Claim from event. Source: `event:evt-123-abc`',
    });
    await brain(['index', 'rebuild']);

    const processRes = await brain(['process']);
    expect(processRes.code).toBe(0);
    expect(processRes.stdout).toContain('Retro-linked');
    expect(processRes.stdout).toContain('event');

    const db2 = openDb();
    const evt = db2.prepare('SELECT processed FROM raw_events WHERE id = ?').get(eventId) as any;
    expect(evt.processed).toBe(1);
    const eventSrc = (db2.prepare('SELECT COUNT(*) as c FROM claim_sources_event WHERE event_id = ?').get(eventId) as any).c;
    expect(eventSrc).toBeGreaterThanOrEqual(1);
    const pageSourceCount = (db2.prepare('SELECT source_count FROM wiki_pages WHERE slug = ?').get('RetroEvent') as any).source_count;
    expect(pageSourceCount).toBe(1);
    db2.close();
  });
});

// ---------- HYBRID SEARCH: event reserved lane ----------

describe.serial('hybridSearch — events surface via reserved lane', () => {
  test.serial('event row appears in brain search output even with wiki hits', async () => {
    await brain(['queue']); // bootstrap
    const db = openDb();
    // Seed enough wiki pages to dominate RRF
    for (let i = 0; i < 5; i++) {
      writeWikiPage(`Page${i}`, {
        title: `Page ${i}`,
        summary: `Mnemonic architecture note ${i}.`,
      });
    }
    // Insert an event that should match
    db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed)
      VALUES ('llm_chat', 'mm', 'evt-search-1', datetime('now'), 'provenance timeline citation test content', 'Claude Session — mm — evt-sear', 0)`).run();
    db.prepare(`INSERT INTO events_fts (external_id, project, source_type, title, content)
      VALUES (?, ?, ?, ?, ?)`).run('evt-search-1', 'mm', 'llm_chat', 'Claude Session — mm — evt-sear', 'provenance timeline citation test content');
    db.close();
    await brain(['index', 'rebuild']);

    const res = await brain(['search', 'provenance']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('[EVENT]');
  });
});

describe.serial('hybridSearch — distilled notes join RRF', () => {
  test.serial('fuses note FTS/vector hits, honors filters, and exposes verified source provenance', async () => {
    const proc = Bun.spawn(['bun', '-e', `
      globalThis.fetch = async () => new Response(JSON.stringify({ embedding: [1, 0] }), {
        headers: { 'content-type': 'application/json' },
      });
      const core = await import('${path.join(REPO, 'src', 'core.ts')}');
      core.initDb();
      const content = 'User: semantic compass evidence\\n\\nAssistant: captured';
      core.upsertRawEvent({
        source_type: 'llm_chat', project: 'mm', external_id: 'evt-note-search',
        timestamp: '2026-09-25T00:00:00Z', content, title: 'Search source',
      });
      const event = core.db.prepare('SELECT id FROM raw_events WHERE external_id = ?').get('evt-note-search');
      const chunkId = core.insertChunkVirtual({
        project: 'mm', source_event_id: event.id, chunk_index: 1, chunk_total: 1,
        segment_start: 0, segment_end: content.length,
      });
      const added = core.addNote({
        source_chunk_id: chunkId,
        summary: 'The semantic compass keeps retrieval grounded.',
        artifacts: [{ type: 'decision', title: 'Semantic Compass', body: 'Prefer distilled evidence.' }],
      });
      core.db.prepare('UPDATE notes SET embedding = ? WHERE id = ?')
        .run(Buffer.from(new Float32Array([1, 0]).buffer), added.note_id);

      const all = await core.hybridSearch('semantic compass', 10);
      const noteOnly = await core.hybridSearch('semantic compass', 10, { sourceTypes: ['note'], projects: ['mm'] });
      const excluded = await core.hybridSearch('semantic compass', 10, { sourceTypes: ['event'] });
      const wrongProject = await core.hybridSearch('semantic compass', 10, { sourceTypes: ['note'], projects: ['other'] });
      core.upsertRawEvent({
        source_type: 'llm_chat', project: 'mm', external_id: 'evt-note-search',
        timestamp: '2026-09-25T00:01:00Z', content: 'rewritten source', title: 'Search source',
      });
      const stale = await core.hybridSearch('semantic compass', 10, { sourceTypes: ['note'] });
      console.log(JSON.stringify({ all, noteOnly, excluded, wrongProject, stale }));
    `], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(code || 0).toBe(0);
    expect(stderr).toBe('');
    const result = JSON.parse(stdout.trim());
    const note = result.all.find((row: any) => row.source === 'note');
    expect(note).toBeDefined();
    expect(note.score).toBeGreaterThan(0.03); // one RRF contribution from each arm
    expect(note.external_id).toBe('evt-note-search');
    expect(note.source_provenance_status).toBe('valid');
    expect(result.noteOnly.map((row: any) => row.source)).toEqual(['note']);
    expect(result.excluded.some((row: any) => row.source === 'note')).toBe(false);
    expect(result.wrongProject.some((row: any) => row.source === 'note')).toBe(false);
    expect(result.stale.find((row: any) => row.source === 'note').source_provenance_status).toBe('stale');
  });
});

// ---------- /active endpoint shape ----------

describe.serial('GET /active markdown shape', () => {
  test.serial('populated + empty forms match the canonical template', async () => {
    await brain(['queue']); // bootstrap
    const db = openDb();
    // Seed an import_state row visible to /active
    const nowMs = Date.now();
    db.prepare(`INSERT INTO import_state
      (source_path, last_mtime, last_imported_at, provider, external_id, project, cwd, model, last_user_snippet, min_turns_ok)
      VALUES (?, ?, datetime('now'), 'claude', 'sess-dash-1', 'mm', '/tmp/mm', 'claude-opus-4-7', 'Hi there', 1)`).run(
        '/tmp/fake.jsonl', nowMs,
      );
    db.close();

    const testPort = await getFreePort();
    const api = Bun.spawn(['bun', API_TS], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_PORT: String(testPort) },
      stdout: 'pipe', stderr: 'pipe',
    });
    const base = `http://localhost:${testPort}`;
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`${base}/stats`);
        if (r.ok) { ready = true; break; }
      } catch {}
      if (api.exitCode !== null) break;
      await new Promise(r => setTimeout(r, 100));
    }
    try {
      if (!ready) {
        api.kill();
        const stderr = await new Response(api.stderr).text();
        throw new Error(stderr || `API did not start on ${base}`);
      }
      const r = await fetch(`${base}/active?max_age_seconds=600`);
      expect(r.ok).toBe(true);
      const md = await r.text();
      expect(md).toContain('# Active agents');
      expect(md).toContain('**claude**');
      expect(md).toContain('`mm`');
      expect(md).toContain('sess-dash-1');
      expect(md).toContain('last user turn: "Hi there"');

      // Empty form — delete the seed row and re-query.
      const db2 = openDb();
      db2.run('DELETE FROM import_state');
      db2.close();
      const r2 = await fetch(`${base}/active?max_age_seconds=600`);
      const md2 = await r2.text();
      expect(md2).toContain('# Active agents');
      expect(md2).toContain('_No agents active._');
    } finally {
      api.kill();
      await api.exited;
    }
  });
});

// ---------- CHUNKER ----------

describe.serial('chunk-events — raw_events to chunks_virtual (v11)', () => {
  async function chunker(args: string[] = []) {
    const proc = Bun.spawn(['bun', CHUNK_EVENTS_TS, ...args], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: code || 0, stdout, stderr };
  }

  test.serial('splits a session at turn boundaries and emits contiguous chunks_virtual spans', async () => {
    await brain(['queue']);

    const bigTurn = (role: string, tag: string) => `${role}: ${tag} `.padEnd(6_000, 'x');
    const content = [
      bigTurn('User', 'Q1'),
      bigTurn('Assistant', 'A1'),
      bigTurn('User', 'Q2'),
      bigTurn('Assistant', 'A2'),
    ].join('\n\n');

    const db = openDb();
    const insertRes = db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed, chunked)
      VALUES ('llm_chat', 'testproj', 'evt-chunk-1', '2026-04-18T10:00:00Z', ?, 'Test', 0, 0)`).run(content);
    const evtId = Number(insertRes.lastInsertRowid);
    db.close();

    const res = await chunker(['--project', 'testproj']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('chunks_virtual');

    // No raw/events/*.md files produced (v11: DB-only emission).
    const eventsDir = path.join(tmpRoot, 'raw', 'events');
    if (fs.existsSync(eventsDir)) {
      const anyMd = fs.readdirSync(eventsDir, { recursive: true }).some((f: any) => String(f).endsWith('.md'));
      expect(anyMd).toBe(false);
    }

    const db2 = openDb();
    const rows = db2.prepare(`SELECT chunk_index, chunk_total, segment_start, segment_end, filter_version
                               FROM chunks_virtual WHERE source_event_id = ?
                               ORDER BY chunk_index`).all(evtId) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every(r => r.filter_version >= 1)).toBe(true);
    // Contiguous, ascending.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].segment_start).toBeGreaterThanOrEqual(rows[i - 1].segment_end - 1);
    }
    // chunked flag flipped.
    const row = db2.prepare(`SELECT chunked FROM raw_events WHERE id = ?`).get(evtId) as any;
    expect(row.chunked).toBe(1);
    db2.close();
  });

  test.serial('re-running is idempotent (chunked rows skipped)', async () => {
    await brain(['queue']);
    const db = openDb();
    db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed, chunked)
      VALUES ('llm_chat', 'idem', 'evt-idem-1', '2026-04-18T11:00:00Z',
              'User: hi\n\nAssistant: hello', 'Test', 0, 0)`).run();
    db.close();

    const first = await chunker(['--project', 'idem']);
    if (first.code !== 0) throw new Error(first.stderr || first.stdout);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('1 events');

    const second = await chunker(['--project', 'idem']);
    if (second.code !== 0) throw new Error(second.stderr || second.stdout);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('nothing to do');
  });

  test.serial('brain chunk read reconstructs content with filterMechanical applied', async () => {
    await brain(['queue']);
    const db = openDb();
    const content = 'User: run the check\n\n[tool: Bash]\nls -la\n\nAssistant: done.';
    const insertRes = db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed, chunked)
      VALUES ('llm_chat', 'readtest', 'evt-read-1', '2026-04-18T12:00:00Z', ?, 'Test', 0, 0)`).run(content);
    const evtId = Number(insertRes.lastInsertRowid);
    db.close();

    const chunkRes = await chunker(['--project', 'readtest']);
    expect(chunkRes.code).toBe(0);

    const db2 = openDb();
    const cv = db2.prepare(`SELECT id FROM chunks_virtual WHERE source_event_id = ? ORDER BY id LIMIT 1`).get(evtId) as any;
    db2.close();

    const res = await brain(['chunk', 'read', String(cv.id)]);
    expect(res.code).toBe(0);
    // Bash block is gone; role markers and prose preserved.
    expect(res.stdout).toContain('User: run the check');
    expect(res.stdout).not.toContain('ls -la');
  });

  test.serial('append-grown session retains chunk ids and queues only suffix chunks under its current project', async () => {
    await brain(['queue']);
    const baseTurn = (t: string) => `User: ${t}\n\nAssistant: reply ${t}`;
    const initial = baseTurn('Q1');
    const grown = [baseTurn('Q1'), baseTurn('Q2'), baseTurn('Q3')].join('\n\n');

    const db = openDb();
    const insertRes = db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed, chunked)
      VALUES ('llm_chat', 'growtest', 'evt-grow-1', '2026-04-18T13:00:00Z', ?, 'Test', 0, 0)`).run(initial);
    const evtId = Number(insertRes.lastInsertRowid);
    db.close();

    const first = await chunker(['--project', 'growtest']);
    expect(first.code).toBe(0);

    // Mark the original partition processed: append growth must not queue it again.
    const db2 = openDb();
    const preGrowIds = (db2.prepare(
      'SELECT id FROM chunks_virtual WHERE source_event_id = ?'
    ).all(evtId) as any[]).map((r: any) => r.id);
    expect(preGrowIds.length).toBeGreaterThan(0);
    db2.prepare('UPDATE chunks_virtual SET processed = 1 WHERE source_event_id = ?').run(evtId);
    db2.close();

    const update = Bun.spawn(['bun', '-e', `
      import { initDb, upsertRawEvent } from '${path.join(REPO, 'src', 'core.ts')}';
      initDb();
      console.log(upsertRawEvent({
        source_type: 'llm_chat', project: 'growtest-renamed', external_id: 'evt-grow-1',
        timestamp: '2026-04-18T13:05:00Z', content: ${JSON.stringify(grown)}, title: 'Test',
      }));
    `], { env: { ...process.env, MT_BRAIN_ROOT: tmpRoot }, stdout: 'pipe', stderr: 'pipe' });
    const [updateOut, updateErr, updateCode] = await Promise.all([
      new Response(update.stdout).text(), new Response(update.stderr).text(), update.exited,
    ]);
    expect(updateCode || 0).toBe(0);
    expect(updateErr).toBe('');
    expect(updateOut).toContain('updated');

    const second = await chunker(['--project', 'growtest-renamed']);
    expect(second.code).toBe(0);

    const db3 = openDb();
    const placeholders = preGrowIds.map(() => '?').join(',');
    const retainedCount = (db3.prepare(
      `SELECT COUNT(*) as c FROM chunks_virtual
       WHERE source_event_id = ? AND id IN (${placeholders})`
    ).get(evtId, ...preGrowIds) as any).c;
    const counts = db3.prepare(
      `SELECT COUNT(*) as total, SUM(processed = 1) as processed, SUM(processed = 0) as pending
       FROM chunks_virtual WHERE source_event_id = ?`
    ).get(evtId) as any;
    const oldStates = db3.prepare(
      `SELECT id, processed, project FROM chunks_virtual
       WHERE source_event_id = ? AND id IN (${placeholders}) ORDER BY id`
    ).all(evtId, ...preGrowIds) as any[];
    const projects = db3.prepare(
      `SELECT project, COUNT(*) AS count
       FROM chunks_virtual WHERE source_event_id = ? GROUP BY project`
    ).all(evtId) as any[];
    const oldProjectPending = (db3.prepare(
      `SELECT COUNT(*) AS count FROM chunks_virtual
       WHERE source_event_id = ? AND project = 'growtest' AND processed = 0`
    ).get(evtId) as any).count;
    const currentProjectPending = (db3.prepare(
      `SELECT COUNT(*) AS count FROM chunks_virtual
       WHERE source_event_id = ? AND project = 'growtest-renamed' AND processed = 0`
    ).get(evtId) as any).count;
    db3.close();

    expect(retainedCount).toBe(preGrowIds.length);
    expect(oldStates.every(row => row.processed === 1)).toBe(true);
    expect(oldStates.every(row => row.project === 'growtest-renamed')).toBe(true);
    expect(projects).toEqual([{ project: 'growtest-renamed', count: counts.total }]);
    expect(oldProjectPending).toBe(0);
    expect(counts.total).toBeGreaterThan(preGrowIds.length);
    expect(counts.processed).toBe(preGrowIds.length);
    expect(counts.pending).toBe(counts.total - preGrowIds.length);
    expect(currentProjectPending).toBe(counts.pending);

    const explicit = await chunker(['--project', 'growtest-renamed', '--rechunk']);
    expect(explicit.code).toBe(0);
    const afterExplicit = openDb();
    expect((afterExplicit.prepare(
      `SELECT COUNT(*) AS c FROM chunks_virtual
       WHERE source_event_id = ? AND id IN (${placeholders})`
    ).get(evtId, ...preGrowIds) as any).c).toBe(0);
    expect((afterExplicit.prepare(
      'SELECT COUNT(*) AS c FROM chunks_virtual WHERE source_event_id = ?'
    ).get(evtId) as any).c).toBeGreaterThan(0);
    afterExplicit.close();
  });
});

// ---------- ARTIFACTS (v11) ----------

describe.serial('artifacts — batch + list + supersede + bump-correction', () => {
  async function artifactBatch(inputs: any[]): Promise<{ code: number; stdout: string }> {
    const proc = Bun.spawn(['bun', BRAIN_TS, 'artifact', 'batch'], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    proc.stdin.write(JSON.stringify(inputs));
    await proc.stdin.end();
    const [stdout, _, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: code || 0, stdout };
  }

  test.serial('batch upserts by (project, type, idempotency_key); second call is dedup', async () => {
    await brain(['queue']);
    const input = [{
      project: 'mm', type: 'decision', idempotency_key: 'dec-1',
      data: { statement: 'x' },
    }];
    const first = await artifactBatch(input);
    expect(first.code).toBe(0);
    const firstParsed = JSON.parse(first.stdout);
    expect(firstParsed[0].created).toBe(true);

    const second = await artifactBatch(input);
    expect(second.code).toBe(0);
    const secondParsed = JSON.parse(second.stdout);
    expect(secondParsed[0].id).toBe(firstParsed[0].id);
    expect(secondParsed[0].created).toBe(false);

    const listRes = await brain(['artifact', 'list', '--project', 'mm', '--type', 'decision']);
    expect(listRes.code).toBe(0);
    const rows = JSON.parse(listRes.stdout);
    expect(rows.length).toBe(1);
  });

  test.serial('supersede sets superseded_by and retires the old row', async () => {
    await brain(['queue']);
    const batch1 = await artifactBatch([
      { project: 'mm', type: 'decision', idempotency_key: 'old', data: { statement: 'v1' } },
      { project: 'mm', type: 'decision', idempotency_key: 'new', data: { statement: 'v2' } },
    ]);
    const [oldArt, newArt] = JSON.parse(batch1.stdout);
    const sup = await brain(['artifact', 'supersede', String(oldArt.id), String(newArt.id)]);
    expect(sup.code).toBe(0);

    const listRes = await brain(['artifact', 'list', '--project', 'mm']);
    const rows = JSON.parse(listRes.stdout);
    const oldRow = rows.find((r: any) => r.id === oldArt.id);
    const newRow = rows.find((r: any) => r.id === newArt.id);
    expect(oldRow.status).toBe('retired');
    expect(oldRow.superseded_by).toBe(newArt.id);
    expect(newRow.status).toBe('active');
  });

  test.serial('bump-correction increments count + sets last_seen', async () => {
    await brain(['queue']);
    const batch = await artifactBatch([{
      project: 'mm', type: 'correction', idempotency_key: 'corr-a',
      data: { previous_belief: 'a', corrected_view: 'b', count: 1 },
    }]);
    const [art] = JSON.parse(batch.stdout);

    const bump = await brain(['artifact', 'bump-correction', String(art.id)]);
    expect(bump.code).toBe(0);
    const parsed = JSON.parse(bump.stdout);
    expect(parsed.count).toBe(2);
    expect(typeof parsed.last_seen).toBe('string');
  });
});

describe.serial('notes — add CLI + dedup', () => {
  async function noteAdd(input: any): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(['bun', BRAIN_TS, 'note', 'add'], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    proc.stdin.write(JSON.stringify(input));
    await proc.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: code || 0, stdout, stderr };
  }

  function seedVirtualChunk(project = 'mm'): number {
    const db = openDb();
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const suffix = `${Date.now()}-${Math.random()}`;
      const eventId = Number(db.prepare(
        `INSERT INTO raw_events (source_type, project, external_id, timestamp, content)
         VALUES (?, ?, ?, ?, ?)`
      ).run('llm_chat', project, `note-source-${suffix}`, '2026-04-20T00:00:00.000Z', 'chunk text for notes').lastInsertRowid);
      return Number(db.prepare(
        `INSERT INTO chunks_virtual
         (project, source_event_id, chunk_index, chunk_total, segment_start, segment_end, filter_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(project, eventId, 0, 1, 0, 'chunk text for notes'.length, 2).lastInsertRowid);
    } finally {
      db.close();
    }
  }

  test.serial('note add inserts surviving artifacts, title hashes, and FTS rows', async () => {
    await brain(['queue']);
    const chunkId = seedVirtualChunk('mm');
    const read = await brain(['chunk', 'read', String(chunkId)]);
    expect(read.code).toBe(0);
    expect(read.stdout).toContain('chunk text for notes');

    const res = await noteAdd({
      source_chunk_id: chunkId,
      summary: 'The librarian should extract durable project notes.',
      artifacts: [
        { title: 'Intent Driven Librarian', body: 'Use intent-driven note extraction.', tags: ['intent', 'librarian'] },
        { title: 'Process Notes Later', body: 'Embeddings are written by the batch embed pipeline.' },
      ],
    });
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.inserted_artifact_count).toBe(2);
    expect(parsed.skipped_count).toBe(0);
    expect(typeof parsed.note_id).toBe('number');

    const db = openDb();
    try {
      const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(parsed.note_id) as any;
      expect(note.project).toBe('mm');
      expect(note.source_chunk_id).toBe(chunkId);
      expect(typeof note.source_event_id).toBe('number');
      expect(note.source_external_id).toContain('note-source-');
      expect(note.source_segment_start).toBe(0);
      expect(note.source_segment_end).toBe('chunk text for notes'.length);
      expect(note.source_filter_version).toBe(2);
      expect(note.source_span_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(note.artifacts).length).toBe(2);
      const hashes = (db.prepare('SELECT COUNT(*) as c FROM note_title_hashes WHERE note_id = ?').get(parsed.note_id) as any).c;
      expect(hashes).toBe(2);
      const fts = db.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH 'librarian'").all() as any[];
      expect(fts.map(r => r.note_id)).toContain(parsed.note_id);
    } finally {
      db.close();
    }

    const api = await startApi();
    try {
      const response = await fetch(`${api.base}/note/${parsed.note_id}`);
      expect(response.ok).toBe(true);
      const detail = await response.json() as any;
      expect(detail.source_external_id).toContain('note-source-');
      expect(detail.source_provenance_status).toBe('valid');
    } finally {
      await api.stop();
    }
  });

  test.serial('note add rejects empty artifacts with structured error', async () => {
    await brain(['queue']);
    const chunkId = seedVirtualChunk('mm');
    const res = await noteAdd({ source_chunk_id: chunkId, summary: 'No signal here.', artifacts: [] });
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stderr).error).toBe('validation_no_artifacts');
  });

  test.serial('note add skips duplicate artifact titles and all-deduped notes', async () => {
    await brain(['queue']);
    const firstChunk = seedVirtualChunk('mm');
    const secondChunk = seedVirtualChunk('mm');
    const first = await noteAdd({
      source_chunk_id: firstChunk,
      summary: 'First note.',
      artifacts: [{ title: 'Same Title!', body: 'First body.' }],
    });
    expect(first.code).toBe(0);

    const second = await noteAdd({
      source_chunk_id: secondChunk,
      summary: 'Second note.',
      artifacts: [{ title: 'same title', body: 'Second body.' }],
    });
    expect(second.code).toBe(0);
    const parsed = JSON.parse(second.stdout);
    expect(parsed).toEqual({
      note_id: null,
      inserted_artifact_count: 0,
      skipped_count: 1,
      reason: 'all_artifacts_deduped',
    });
  });

  test.serial('note add reports duplicate source chunk', async () => {
    await brain(['queue']);
    const chunkId = seedVirtualChunk('mm');
    const input = {
      source_chunk_id: chunkId,
      summary: 'Duplicate chunk note.',
      artifacts: [{ title: 'Unique Title', body: 'Body.' }],
    };
    const first = await noteAdd(input);
    expect(first.code).toBe(0);
    const firstParsed = JSON.parse(first.stdout);
    const second = await noteAdd({
      source_chunk_id: chunkId,
      summary: 'Duplicate chunk note again.',
      artifacts: [{ title: 'Another Unique Title', body: 'Body.' }],
    });
    expect(second.code).toBe(1);
    const err = JSON.parse(second.stderr);
    expect(err.error).toBe('duplicate_chunk');
    expect(err.existing_note_id).toBe(firstParsed.note_id);
  });

  test.serial('raw event update can clear stale virtual chunks after note add', async () => {
    const proc = Bun.spawn(['bun', '-e', `
      import { initDb, db, upsertRawEvent, insertChunkVirtual, addNote, getNote } from '${path.join(REPO, 'src', 'core.ts')}';
      initDb();
      upsertRawEvent({
        source_type: 'llm_chat', project: 'mm',
        external_id: 'note-rechunk', timestamp: '2026-04-18T10:00:00Z',
        content: 'first content for distill',
      });
      const evt = db.prepare("SELECT id FROM raw_events WHERE external_id = 'note-rechunk'").get();
      const chunkId = insertChunkVirtual({
        project: 'mm',
        source_event_id: evt.id,
        chunk_index: 0,
        chunk_total: 1,
        segment_start: 0,
        segment_end: 'first content for distill'.length,
      });
      const note = addNote({
        source_chunk_id: chunkId,
        summary: 'Distilled note summary.',
        artifacts: [{ title: 'Durable Rechunk Note', body: 'This note must survive reimport.' }],
      });
      const update = upsertRawEvent({
        source_type: 'llm_chat', project: 'mm',
        external_id: 'note-rechunk', timestamp: '2026-04-18T10:05:00Z',
        content: 'rewritten content with different provenance',
      });
      const chunks = db.prepare('SELECT COUNT(*) as c FROM chunks_virtual WHERE source_event_id = ?').get(evt.id);
      const row = getNote(note.note_id);
      console.log(JSON.stringify({ update, chunks: chunks.c, note: row }));
    `], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code || 0).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout.trim().split('\n').pop()!);
    expect(parsed.update).toBe('updated');
    expect(parsed.chunks).toBe(0);
    expect(typeof parsed.note.id).toBe('number');
    expect(parsed.note.source_chunk_id).toBeGreaterThan(0);
    expect(parsed.note.source_external_id).toBe('note-rechunk');
    expect(parsed.note.source_provenance_status).toBe('stale');
  });
});

describe.serial('notes API', () => {
  test.serial('/notes returns an empty list on a fresh root', async () => {
    await brain(['queue']);
    const api = await startApi();
    try {
      const r = await fetch(`${api.base}/notes`);
      expect(r.ok).toBe(true);
      expect(await r.json()).toEqual([]);
    } finally {
      await api.stop();
    }
  });

  test.serial('/notes lists notes with filtering and pagination', async () => {
    await brain(['queue']);
    const first = seedNote('mm', 101, 'First durable note summary.', [
      { title: 'First Note', body: 'First body.' },
    ]);
    const second = seedNote('mm', 202, 'Second durable note summary.', [
      { title: 'Second Note', body: 'Second body.' },
      { title: 'Second Extra', body: 'Extra body.' },
    ]);
    seedNote('ac', 303, 'Different project note summary.', [
      { title: 'Other Project', body: 'Other body.' },
    ]);

    const api = await startApi();
    try {
      const all = await fetch(`${api.base}/notes?project=mm&limit=10`);
      expect(all.ok).toBe(true);
      const rows = await all.json() as any[];
      expect(rows.map(r => r.id)).toEqual([second, first]);
      expect(rows[0]).toMatchObject({
        project: 'mm',
        source_chunk_id: 202,
        artifact_count: 2,
      });
      expect(rows[0].artifacts).toBeUndefined();

      const filtered = await fetch(`${api.base}/notes?source_chunk_id=101`);
      expect(filtered.ok).toBe(true);
      const filteredRows = await filtered.json() as any[];
      expect(filteredRows.map(r => r.id)).toEqual([first]);

      const paged = await fetch(`${api.base}/notes?project=mm&limit=1&offset=1`);
      expect(paged.ok).toBe(true);
      const pagedRows = await paged.json() as any[];
      expect(pagedRows.map(r => r.id)).toEqual([first]);
    } finally {
      await api.stop();
    }
  });

  test.serial('/note/:id returns detail and 404 for missing notes', async () => {
    await brain(['queue']);
    const id = seedNote('mm', 404, 'Detail note summary.', [
      { title: 'Detail Note', body: 'Body with **markdown**.', tags: ['detail', 'notes'] },
    ]);

    const api = await startApi();
    try {
      const r = await fetch(`${api.base}/note/${id}`);
      expect(r.ok).toBe(true);
      const note = await r.json() as any;
      expect(note.id).toBe(id);
      expect(note.artifact_count).toBe(1);
      expect(note.artifacts).toEqual([
        { title: 'Detail Note', body: 'Body with **markdown**.', tags: ['detail', 'notes'] },
      ]);

      const missing = await fetch(`${api.base}/note/999999`);
      expect(missing.status).toBe(404);
    } finally {
      await api.stop();
    }
  });

  test.serial('/notes-search returns matches and no-match empty arrays', async () => {
    await brain(['queue']);
    const id = seedNote('mm', 505, 'Searchable librarian summary.', [
      { title: 'Reverse Proxy Lesson', body: 'Plugin base paths must prefix scripts.' },
    ]);
    seedNote('ac', 606, 'Unrelated note summary.', [
      { title: 'Other Lesson', body: 'Separate project body.' },
    ]);

    const api = await startApi();
    try {
      const match = await fetch(`${api.base}/notes-search?q=proxy&project=mm`);
      expect(match.ok).toBe(true);
      const rows = await match.json() as any[];
      expect(rows.map(r => r.id)).toEqual([id]);
      expect(rows[0].artifact_count).toBe(1);
      expect(typeof rows[0].rank).toBe('number');

      const none = await fetch(`${api.base}/notes-search?q=definitelymissing&project=mm`);
      expect(none.ok).toBe(true);
      expect(await none.json()).toEqual([]);
    } finally {
      await api.stop();
    }
  });
});

describe.serial('note provenance repair', () => {
  test.serial('dry-run and apply recover exact and relocated backup spans without guessing', async () => {
    await brain(['queue']);
    const backupPath = path.join(tmpRoot, 'meta', 'pre-repair.db');
    const csvPath = path.join(tmpRoot, 'meta', 'provenance.csv');
    const sameContent = 'User: stable source text\n\nAssistant: stable answer';
    const movedSpan = 'User: relocate this exact source span';
    const movedOldContent = `${movedSpan}\n\nAssistant: old answer`;
    const missingOldContent = 'User: source removed by normalization';

    const db = openDb();
    db.prepare(`INSERT INTO raw_events (source_type, project, external_id, timestamp, content)
                VALUES ('llm_chat', 'mm', 'event:same', '2026-09-25T00:00:00Z', ?)`).run(sameContent);
    db.prepare(`INSERT INTO raw_events (source_type, project, external_id, timestamp, content)
                VALUES ('llm_chat', 'mm', 'event:moved', '2026-09-25T00:00:00Z', ?)`).run(movedOldContent);
    db.prepare(`INSERT INTO raw_events (source_type, project, external_id, timestamp, content)
                VALUES ('llm_chat', 'mm', 'event:missing', '2026-09-25T00:00:00Z', ?)`).run(missingOldContent);
    const sameNote = seedNote('mm', 701, 'Same-offset repair.', [{ title: 'Repair Same', body: 'Body.' }]);
    const movedNote = seedNote('mm', 702, 'Relocated repair.', [{ title: 'Repair Moved', body: 'Body.' }]);
    const missingNote = seedNote('mm', 703, 'Missing repair.', [{ title: 'Repair Missing', body: 'Body.' }]);
    const blankNote = seedNote('mm', 704, 'No coordinates.', [{ title: 'Repair Blank', body: 'Body.' }]);
    const escapedBackup = backupPath.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escapedBackup}'`);
    db.prepare(`UPDATE raw_events SET content = ? WHERE external_id = 'event:moved'`)
      .run(`Header added later\n\n${movedOldContent}`);
    db.prepare(`UPDATE raw_events SET content = 'Assistant: normalized content only' WHERE external_id = 'event:missing'`).run();
    db.close();

    fs.writeFileSync(csvPath, [
      'note_id,project,source_chunk_id,external_id,chunk_index,chunk_total,segment_start,segment_end,filter_version',
      `${sameNote},mm,701,event:same,1,1,0,${sameContent.length},2`,
      `${movedNote},mm,702,event:moved,1,1,0,${movedSpan.length},2`,
      `${missingNote},mm,703,event:missing,1,1,0,${missingOldContent.length},2`,
      `${blankNote},mm,704,,,,,,`,
    ].join('\n') + '\n');

    const runRepair = async (apply: boolean) => {
      const proc = Bun.spawn([
        'bun', REPAIR_NOTE_PROVENANCE_TS,
        '--db', path.join(tmpRoot, 'meta', 'brain.db'),
        '--backup-db', backupPath,
        '--csv', csvPath,
        ...(apply ? ['--apply'] : []),
      ], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      return { stdout, stderr, code: code || 0 };
    };

    const dryRun = await runRepair(false);
    expect(dryRun.code).toBe(0);
    expect(dryRun.stderr).toBe('');
    const dry = JSON.parse(dryRun.stdout);
    expect(dry).toMatchObject({
      mode: 'dry-run', notes: 4, csv_rows: 4, resolved: 2,
      same_offset: 1, relocated: 1, unresolved: 2,
      unresolved_by_reason: { span_not_found: 1, backup_coordinates_missing: 1 },
    });

    const applied = await runRepair(true);
    if (applied.code !== 0) throw new Error(applied.stderr || applied.stdout);
    expect(applied.code).toBe(0);
    expect(applied.stderr).toBe('');
    expect(JSON.parse(applied.stdout).mode).toBe('apply');

    const after = openDb();
    const rows = after.prepare(
      `SELECT id, source_external_id, source_segment_start, source_segment_end, source_span_hash
       FROM notes ORDER BY id`
    ).all() as any[];
    expect(rows[0].source_external_id).toBe('event:same');
    expect(rows[0].source_segment_start).toBe(0);
    expect(rows[0].source_span_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1].source_external_id).toBe('event:moved');
    expect(rows[1].source_segment_start).toBe('Header added later\n\n'.length);
    expect(rows[2].source_external_id).toBeNull();
    expect(rows[3].source_external_id).toBeNull();
    after.close();
  });
});

describe.serial('brain backup — WAL checkpoint + VACUUM INTO', () => {
  test.serial('produces a valid SQLite file readable at schema_version=16', async () => {
    await brain(['queue']);
    const target = path.join(tmpRoot, 'meta', 'snap.db');
    const res = await brain(['backup', '--target', target]);
    expect(res.code).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    const snap = new Database(target, { readonly: true });
    const v = (snap.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any).version;
    expect(v).toBe(16);
    snap.close();
  });
});

describe.serial('filterMechanical — narrative filter semantics', () => {
  test.serial('strips noise-tool blocks, preserves error lines, compresses Edit', async () => {
    const { filterMechanical } = await import(path.join(REPO, 'src', 'narrative.ts'));
    const input = [
      'User: list',
      '',
      '[tool: Bash]',
      'ls -la',
      'Error: permission denied',
      'trailing log line',
      '',
      'Assistant: here is the fix',
      '',
      '[tool: Edit]',
      '- old',
      '+ new',
      '',
      'User: done',
    ].join('\n');
    const out = filterMechanical(input);
    expect(out).toContain('User: list');
    expect(out).not.toContain('ls -la');
    expect(out).not.toContain('trailing log line');
    expect(out).toContain('Error: permission denied');
    expect(out).toContain('[code-change: Edit]');
    expect(out).toContain('- old');
    expect(out).toContain('+ new');
  });
});

// ---------- IMPORTER DEDUP ----------

describe.serial('import-claude dedup', () => {
  test.serial('re-running the importer against the same JSONL yields 0 new rows', async () => {
    // Build a synthetic claude projects tree
    const projectsDir = path.join(tmpRoot, 'claude-projects');
    const sessionsDir = path.join(projectsDir, '-Users-test-work-mm');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const jsonl = path.join(sessionsDir, 'sess-dedup.jsonl');
    fs.writeFileSync(jsonl, [
      JSON.stringify({ sessionId: 'sess-dedup', type: 'user',      timestamp: '2026-04-18T10:00:00Z', cwd: '/Users/test/work/mm', message: { content: 'Hello' } }),
      JSON.stringify({ sessionId: 'sess-dedup', type: 'assistant', timestamp: '2026-04-18T10:00:05Z', message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: 'Hi!' }] } }),
      JSON.stringify({ sessionId: 'sess-dedup', type: 'user',      timestamp: '2026-04-18T10:00:10Z', cwd: '/Users/test/work/mm', message: { content: 'More' } }),
      JSON.stringify({ sessionId: 'sess-dedup', type: 'assistant', timestamp: '2026-04-18T10:00:15Z', message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: 'Ok.' }] } }),
    ].join('\n') + '\n');
    // Age the file so settled-session accepts it
    const aged = (Date.now() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(jsonl, aged, aged);

    const runImporter = async (extra: string[] = []) => {
      const proc = Bun.spawn(['bun', IMPORT_CLAUDE_TS, '--projects-dir', projectsDir, '--days', '0', '--min-turns', '1', ...extra], {
        env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
        stdout: 'pipe', stderr: 'pipe',
      });
      const [out, , code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, out };
    };

    const first = await runImporter();
    expect(first.code).toBe(0);
    expect(first.out).toContain('imported:          1');

    const db = openDb();
    expect((db.prepare('SELECT COUNT(*) AS c FROM raw_events WHERE external_id = ?').get('claude:sess-dedup') as any).c).toBe(1);
    db.close();

    const second = await runImporter(['--force']);
    expect(second.code).toBe(0);
    expect(second.out).toContain('duplicate (dedup): 1');
    expect(second.out).toContain('imported:          0');
  });

  test.serial('extending a session with processed=1 re-chunks AND resets processed (was stranded under v11.1)', async () => {
    const projectsDir = path.join(tmpRoot, 'claude-projects');
    const sessionsDir = path.join(projectsDir, '-Users-test-work-mm');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const jsonl = path.join(sessionsDir, 'sess-processed.jsonl');

    const writeJsonl = (lines: any[]) =>
      fs.writeFileSync(jsonl, lines.map(l => JSON.stringify(l)).join('\n') + '\n');

    const baseTurns = [
      { sessionId: 'sess-processed', type: 'user', timestamp: '2026-04-18T10:00:00Z', cwd: '/Users/test/work/mm', message: { content: 'initial turn' } },
      { sessionId: 'sess-processed', type: 'assistant', timestamp: '2026-04-18T10:00:05Z', message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: 'reply' }] } },
    ];
    writeJsonl(baseTurns);
    const aged = (Date.now() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(jsonl, aged, aged);

    const runImporter = async () => {
      const proc = Bun.spawn(['bun', IMPORT_CLAUDE_TS, '--projects-dir', projectsDir, '--days', '0', '--min-turns', '1'], {
        env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
        stdout: 'pipe', stderr: 'pipe',
      });
      await proc.exited;
      return proc;
    };

    await runImporter();

    // Simulate a v10 wiki ingest having already processed this row.
    const db1 = openDb();
    db1.prepare(`UPDATE raw_events SET processed = 1, chunked = 1 WHERE external_id = 'claude:sess-processed'`).run();
    db1.close();

    writeJsonl([
      ...baseTurns,
      { sessionId: 'sess-processed', type: 'user', timestamp: '2026-04-18T10:01:00Z', cwd: '/Users/test/work/mm', message: { content: 'a later turn UNIQUE_LATER' } },
      { sessionId: 'sess-processed', type: 'assistant', timestamp: '2026-04-18T10:01:05Z', message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: 'fine' }] } },
    ]);
    const aged2 = (Date.now() - 9 * 60 * 1000) / 1000;
    fs.utimesSync(jsonl, aged2, aged2);

    await runImporter();

    const db2 = openDb();
    const row = db2.prepare(`SELECT content, processed, chunked FROM raw_events WHERE external_id = 'claude:sess-processed'`).get() as any;
    db2.close();
    expect(row.content).toContain('UNIQUE_LATER');
    expect(row.processed).toBe(0); // reset — row is no longer stranded
    expect(row.chunked).toBe(0);
  });

  test.serial('upsertRawEvent keeps raw_events and events_fts in sync when project changes', async () => {
    // Use a direct bun -e invocation so we can control inputs precisely.
    const proc = Bun.spawn(['bun', '-e', `
      import { initDb, db, upsertRawEvent } from '${path.join(REPO, 'src', 'core.ts')}';
      initDb();
      upsertRawEvent({
        source_type: 'llm_chat', project: 'oldproj',
        external_id: 'sync-test', timestamp: '2026-04-18T10:00:00Z',
        content: 'first content', title: 't1',
      });
      const r1 = upsertRawEvent({
        source_type: 'llm_chat', project: 'newproj',
        external_id: 'sync-test', timestamp: '2026-04-18T11:00:00Z',
        content: 'second content — UNIQUE_CHANGED', title: 't2',
      });
      console.log(JSON.stringify({ result: r1 }));
      const re = db.prepare("SELECT project, source_type FROM raw_events WHERE external_id = 'sync-test'").get();
      const fts = db.prepare("SELECT project, source_type FROM events_fts WHERE external_id = 'sync-test'").get();
      console.log(JSON.stringify({ re, fts }));
    `], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe', stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const lines = stdout.trim().split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]);
    const state = JSON.parse(lines[1]);
    expect(first.result).toBe('updated');
    expect(state.re.project).toBe('newproj');
    expect(state.re.source_type).toBe('llm_chat');
    expect(state.fts.project).toBe('newproj');
    // Invariant: raw_events.project === events_fts.project after any upsert.
    expect(state.re.project).toBe(state.fts.project);
  });

  test.serial('upsertRawEvent is transactional — FTS failure rolls back the raw_events update', async () => {
    // Seed one row, then corrupt events_fts so the UPDATE path's DELETE/INSERT
    // will fail. The tx wrap must ensure raw_events.content doesn't move.
    const proc = Bun.spawn(['bun', '-e', `
      import { initDb, db, upsertRawEvent } from '${path.join(REPO, 'src', 'core.ts')}';
      initDb();
      upsertRawEvent({
        source_type: 'llm_chat', project: 'tx',
        external_id: 'tx-test', timestamp: '2026-04-18T10:00:00Z',
        content: 'original',
      });
      // Drop the events_fts virtual table to force a failure inside the tx.
      db.exec('DROP TABLE IF EXISTS events_fts');
      let threw = false;
      try {
        upsertRawEvent({
          source_type: 'llm_chat', project: 'tx',
          external_id: 'tx-test', timestamp: '2026-04-18T11:00:00Z',
          content: 'OVERWRITTEN',
        });
      } catch { threw = true; }
      const row = db.prepare("SELECT content, chunked FROM raw_events WHERE external_id = 'tx-test'").get();
      console.log(JSON.stringify({ threw, content: row.content, chunked: row.chunked }));
    `], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe', stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(stdout.trim().split('\n').pop()!);
    expect(parsed.threw).toBe(true);
    expect(parsed.content).toBe('original');  // rolled back
    expect(parsed.chunked).toBe(0);            // original insert state preserved
  });

  test.serial('extending a session (same id, new turns) updates content and resets chunked', async () => {
    const projectsDir = path.join(tmpRoot, 'claude-projects');
    const sessionsDir = path.join(projectsDir, '-Users-test-work-mm');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const jsonl = path.join(sessionsDir, 'sess-grow.jsonl');

    const writeJsonl = (lines: any[]) => {
      fs.writeFileSync(jsonl, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    };

    const baseTurns = [
      { sessionId: 'sess-grow', type: 'user',      timestamp: '2026-04-18T10:00:00Z', cwd: '/Users/test/work/mm', message: { content: 'Hello' } },
      { sessionId: 'sess-grow', type: 'assistant', timestamp: '2026-04-18T10:00:05Z', message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: 'Hi!' }] } },
    ];
    writeJsonl(baseTurns);
    const aged = (Date.now() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(jsonl, aged, aged);

    const runImporter = async () => {
      const proc = Bun.spawn(['bun', IMPORT_CLAUDE_TS, '--projects-dir', projectsDir, '--days', '0', '--min-turns', '1'], {
        env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
        stdout: 'pipe', stderr: 'pipe',
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code: code || 0, out, err };
    };

    const first = await runImporter();
    expect(first.code).toBe(0);
    expect(first.out).toContain('imported:          1');

    // Simulate the chunker having already run against the original content.
    const db1 = openDb();
    db1.prepare(`UPDATE raw_events SET chunked = 1 WHERE external_id = 'claude:sess-grow'`).run();
    const contentBefore = (db1.prepare(`SELECT content, content_hash FROM raw_events WHERE external_id = 'claude:sess-grow'`).get() as any);
    db1.close();
    expect(contentBefore.content).toContain('Hi!');
    expect(contentBefore.content_hash).toBeTruthy();

    // Extend the session with new turns and bump mtime.
    const extendedTurns = [
      ...baseTurns,
      { sessionId: 'sess-grow', type: 'user',      timestamp: '2026-04-18T10:01:00Z', cwd: '/Users/test/work/mm', message: { content: 'One more thing — UNIQUE_NEW_TURN_TOKEN' } },
      { sessionId: 'sess-grow', type: 'assistant', timestamp: '2026-04-18T10:01:05Z', message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: 'Sure.' }] } },
    ];
    writeJsonl(extendedTurns);
    const aged2 = (Date.now() - 9 * 60 * 1000) / 1000;
    fs.utimesSync(jsonl, aged2, aged2);

    const second = await runImporter();
    if (second.code !== 0) throw new Error(second.err || second.out);
    expect(second.code).toBe(0);
    expect(second.out).toContain('updated:           1');

    const db2 = openDb();
    const row = db2.prepare(`SELECT content, content_hash, chunked FROM raw_events WHERE external_id = 'claude:sess-grow'`).get() as any;
    expect(row.content).toContain('UNIQUE_NEW_TURN_TOKEN');
    expect(row.content_hash).not.toBe(contentBefore.content_hash);
    expect(row.chunked).toBe(0); // reset so chunker re-emits
    // Row count unchanged (upsert, not duplicate insert).
    expect((db2.prepare(`SELECT COUNT(*) AS c FROM raw_events WHERE external_id = 'claude:sess-grow'`).get() as any).c).toBe(1);
    db2.close();
  });
});

// ---------- ARTIFACT SEARCH (FTS) ----------

describe.serial('brain artifact search — FTS over artifact data', () => {
  async function artifactBatch(inputs: any[]): Promise<void> {
    const proc = Bun.spawn(['bun', BRAIN_TS, 'artifact', 'batch'], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    proc.stdin.write(JSON.stringify(inputs));
    await proc.stdin.end();
    await proc.exited;
  }

  test.serial('matches on statement text across types with project + type filters', async () => {
    await brain(['queue']);

    await artifactBatch([
      { project: 'mm', type: 'decision', idempotency_key: 'search-1',
        data: { statement: 'Use virtual chunks emitted by the narrative chunker' } },
      { project: 'mm', type: 'bug', idempotency_key: 'search-2',
        data: { symptom: 'Librarian prompt carries v10 extraction buckets', severity: 'high', status: 'fixed' } },
      { project: 'other', type: 'decision', idempotency_key: 'search-3',
        data: { statement: 'Unrelated project decision' } },
    ]);

    const byStatement = await brain(['artifact', 'search', 'narrative chunker', '--project', 'mm']);
    expect(byStatement.code).toBe(0);
    const hits1 = JSON.parse(byStatement.stdout);
    expect(hits1.length).toBeGreaterThanOrEqual(1);
    expect(hits1[0].idempotency_key).toBe('search-1');
    expect(hits1[0].snippet.length).toBeGreaterThan(0);

    const bySymptom = await brain(['artifact', 'search', 'extraction buckets', '--project', 'mm', '--type', 'bug']);
    const hits2 = JSON.parse(bySymptom.stdout);
    expect(hits2.length).toBe(1);
    expect(hits2[0].idempotency_key).toBe('search-2');

    const scoped = await brain(['artifact', 'search', 'decision', '--project', 'mm']);
    const hits3 = JSON.parse(scoped.stdout);
    expect(hits3.every((h: any) => h.project === 'mm')).toBe(true);
  });
});

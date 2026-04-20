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

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const BRAIN_TS = path.join(REPO, 'src', 'brain.ts');
const API_TS   = path.join(REPO, 'src', 'api.ts');
const IMPORT_CLAUDE_TS = path.join(REPO, 'scripts', 'import-claude.ts');
const CHUNK_EVENTS_TS = path.join(REPO, 'scripts', 'chunk-events.ts');

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

// ---------- SCHEMA ----------

describe('schema migration', () => {
  test('fresh root bootstraps to v11', async () => {
    await brain(['queue']);
    const db = openDb();
    const version = (db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any).version;
    expect(version).toBe(11);
    const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const name of [
      'raw_entries', 'raw_events', 'wiki_pages', 'claims', 'claim_sources', 'claim_sources_event', 'import_state',
      'artifacts', 'artifact_sources', 'chunks_virtual',
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
    db.close();
  });
});

// ---------- OPTION A: RAW RETRO-SWEEP ----------

describe('brain process — Phase 1 retro-sweep', () => {
  test('raw entry cited by wiki timeline gets retro-linked without LLM', async () => {
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

  test('raw entry with no citation stays processed=0 when LLM is unavailable', async () => {
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

describe('brain process — event retro-sweep', () => {
  test('event cited by wiki timeline via `event:<id>` gets retro-linked', async () => {
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

describe('hybridSearch — events surface via reserved lane', () => {
  test('event row appears in brain search output even with wiki hits', async () => {
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

// ---------- /active endpoint shape ----------

describe('GET /active markdown shape', () => {
  test('populated + empty forms match the canonical template', async () => {
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

    // Spawn API on a high random port so we don't collide with a real API on :3000.
    const testPort = 30000 + Math.floor(Math.random() * 30000);
    const api = Bun.spawn(['bun', API_TS], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_PORT: String(testPort) },
      stdout: 'pipe', stderr: 'pipe',
    });
    const base = `http://localhost:${testPort}`;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`${base}/stats`);
        if (r.ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    try {
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

describe('chunk-events — raw_events to chunks_virtual (v11)', () => {
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

  test('splits a session at turn boundaries and emits contiguous chunks_virtual spans', async () => {
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

  test('re-running is idempotent (chunked rows skipped)', async () => {
    await brain(['queue']);
    const db = openDb();
    db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed, chunked)
      VALUES ('llm_chat', 'idem', 'evt-idem-1', '2026-04-18T11:00:00Z',
              'User: hi\n\nAssistant: hello', 'Test', 0, 0)`).run();
    db.close();

    const first = await chunker(['--project', 'idem']);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('1 events');

    const second = await chunker(['--project', 'idem']);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('nothing to do');
  });

  test('brain chunk read reconstructs content with filterMechanical applied', async () => {
    await brain(['queue']);
    const db = openDb();
    const content = 'User: run the check\n\n[tool: Bash]\nls -la\n\nAssistant: done.';
    const insertRes = db.prepare(`INSERT INTO raw_events
      (source_type, project, external_id, timestamp, content, title, processed, chunked)
      VALUES ('llm_chat', 'readtest', 'evt-read-1', '2026-04-18T12:00:00Z', ?, 'Test', 0, 0)`).run(content);
    const evtId = Number(insertRes.lastInsertRowid);
    db.close();

    await chunker(['--project', 'readtest']);

    const db2 = openDb();
    const cv = db2.prepare(`SELECT id FROM chunks_virtual WHERE source_event_id = ? ORDER BY id LIMIT 1`).get(evtId) as any;
    db2.close();

    const res = await brain(['chunk', 'read', String(cv.id)]);
    expect(res.code).toBe(0);
    // Bash block is gone; role markers and prose preserved.
    expect(res.stdout).toContain('User: run the check');
    expect(res.stdout).not.toContain('ls -la');
  });
});

// ---------- ARTIFACTS (v11) ----------

describe('artifacts — batch + list + supersede + bump-correction', () => {
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

  test('batch upserts by (project, type, idempotency_key); second call is dedup', async () => {
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

  test('supersede sets superseded_by and retires the old row', async () => {
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

  test('bump-correction increments count + sets last_seen', async () => {
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

describe('brain backup — WAL checkpoint + VACUUM INTO', () => {
  test('produces a valid SQLite file readable at schema_version=11', async () => {
    await brain(['queue']);
    const target = path.join(tmpRoot, 'meta', 'snap.db');
    const res = await brain(['backup', '--target', target]);
    expect(res.code).toBe(0);
    expect(fs.existsSync(target)).toBe(true);
    const snap = new Database(target, { readonly: true });
    const v = (snap.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any).version;
    expect(v).toBe(11);
    snap.close();
  });
});

describe('filterMechanical — narrative filter semantics', () => {
  test('strips noise-tool blocks, preserves error lines, compresses Edit', async () => {
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

describe('import-claude dedup', () => {
  test('re-running the importer against the same JSONL yields 0 new rows', async () => {
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
    expect((db.prepare('SELECT COUNT(*) AS c FROM raw_events WHERE external_id = ?').get('sess-dedup') as any).c).toBe(1);
    db.close();

    const second = await runImporter(['--force']);
    expect(second.code).toBe(0);
    expect(second.out).toContain('duplicate (dedup): 1');
    expect(second.out).toContain('imported:          0');
  });
});

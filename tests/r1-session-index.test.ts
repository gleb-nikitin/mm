import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveSessionLinks } from '../src/r1/ac-link.ts';

const REPO = path.resolve(import.meta.dir, '..');
let tmpRoot: string;
let acDbPath: string;

function makeAcShapeDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    role TEXT NOT NULL,
    active_session_id TEXT
  );
  CREATE TABLE valhalla_sessions (
    participant_id TEXT NOT NULL,
    version_n INTEGER NOT NULL,
    old_session_id TEXT NOT NULL
  );`);
  return db;
}

function runEval(code: string, extraEnv: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ['bun', '-e', code],
    cwd: REPO,
    env: {
      ...process.env,
      MT_BRAIN_ROOT: tmpRoot,
      MT_AC_DB_PATH: acDbPath,
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function openBrainDb(): Database {
  return new Database(path.join(tmpRoot, 'meta', 'brain.db'));
}

describe('R1 session linkage index', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-session-index-'));
    fs.mkdirSync(path.join(tmpRoot, 'raw'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'wiki'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'meta'), { recursive: true });
    acDbPath = path.join(tmpRoot, 'ac-msg.db');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('resolveSessionLinks ignores sessions that are not active and not in valhalla', () => {
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', null)`);
    acDb.close();

    const saved = process.env.MT_AC_DB_PATH;
    process.env.MT_AC_DB_PATH = acDbPath;
    try {
      const out = resolveSessionLinks(['sess-inactive']);
      expect(out.acDbAvailable).toBe(true);
      // ac no longer stores inactive session history in msg.db; mm can only
      // resolve the participant whose active_session_id matches the import.
      expect(out.links.has('sess-inactive')).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MT_AC_DB_PATH;
      else process.env.MT_AC_DB_PATH = saved;
    }
  });

  test('resolveSessionLinks resolves historical session ids through valhalla_sessions', () => {
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`
      INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', null);
      INSERT INTO valhalla_sessions (participant_id, version_n, old_session_id) VALUES ('mm_cto', 1, 'sess-old');
    `);
    acDb.close();

    const saved = process.env.MT_AC_DB_PATH;
    process.env.MT_AC_DB_PATH = acDbPath;
    try {
      const out = resolveSessionLinks(['sess-old']);
      expect(out.acDbAvailable).toBe(true);
      expect(out.links.get('sess-old')).toEqual({
        kind: 'retired',
        participant_id: 'mm_cto',
        project: 'mm',
        role: 'cto',
        project_role: 'mm/cto',
      });
    } finally {
      if (saved === undefined) delete process.env.MT_AC_DB_PATH;
      else process.env.MT_AC_DB_PATH = saved;
    }
  });

  test('resolveSessionLinks marks active provenance and gives it precedence over valhalla', () => {
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`
      INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', 'sess-shared');
      INSERT INTO valhalla_sessions (participant_id, version_n, old_session_id) VALUES ('mm_cto', 1, 'sess-shared');
    `);
    acDb.close();

    const saved = process.env.MT_AC_DB_PATH;
    process.env.MT_AC_DB_PATH = acDbPath;
    try {
      expect(resolveSessionLinks(['sess-shared']).links.get('sess-shared')).toEqual({
        kind: 'active',
        participant_id: 'mm_cto',
        project: 'mm',
        role: 'cto',
        project_role: 'mm/cto',
      });
    } finally {
      if (saved === undefined) delete process.env.MT_AC_DB_PATH;
      else process.env.MT_AC_DB_PATH = saved;
    }
  });

  test('upsert is idempotent and preserves one row per vendor/session', () => {
    const res = runEval(`
      const { initDb, db } = await import('./src/core.ts');
      const { recordSessionObservation } = await import('./src/r1/session-index.ts');
      initDb();
      const base = {
        vendor: 'codex',
        session_id: 'sess-upsert',
        source_path: '/tmp/sess.jsonl',
        raw_event_id: null,
        project: 'mm',
        cwd: '/repo/mm',
        model: 'gpt-5',
        started_at: '2026-04-22T10:00:00Z',
        last_activity_at: '2026-04-22T10:00:01Z',
        last_mtime: 1,
        last_log_line: 'first',
        metadata: '{}',
      };
      recordSessionObservation(base);
      recordSessionObservation({ ...base, model: 'gpt-5.1', last_activity_at: '2026-04-22T10:01:00Z', last_log_line: 'second' });
      db.close();
    `);
    expect(res.exitCode).toBe(0);
    const db = openBrainDb();
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM session_index`).get() as any).c;
    const row = db.prepare(`SELECT model, last_log_line FROM session_index WHERE vendor='codex' AND session_id='sess-upsert'`).get() as any;
    expect(count).toBe(1);
    expect(row.model).toBe('gpt-5.1');
    expect(row.last_log_line).toBe('second');
    db.close();
  });

  test('same session_id can exist for different vendors', () => {
    const res = runEval(`
      const { initDb, db } = await import('./src/core.ts');
      const { recordSessionObservation } = await import('./src/r1/session-index.ts');
      initDb();
      for (const vendor of ['claude', 'codex']) {
        recordSessionObservation({
          vendor,
          session_id: 'same-id',
          source_path: '/tmp/' + vendor,
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: vendor + '-model',
          started_at: '2026-04-22T10:00:00Z',
          last_activity_at: '2026-04-22T10:00:01Z',
          last_mtime: 1,
          last_log_line: vendor,
          metadata: '{}',
        });
      }
      db.close();
    `);
    expect(res.exitCode).toBe(0);
    const db = openBrainDb();
    const rows = db.prepare(`SELECT vendor, session_id, model FROM session_index WHERE session_id='same-id' ORDER BY vendor`).all() as any[];
    expect(rows).toEqual([
      { vendor: 'claude', session_id: 'same-id', model: 'claude-model' },
      { vendor: 'codex', session_id: 'same-id', model: 'codex-model' },
    ]);
    db.close();
  });

  test('stored derivation caps age at idle for every vendor and readers preserve it', () => {
    const res = runEval(`
      const { initDb, db } = await import('./src/core.ts');
      const { listActiveSessions, upsertSessionObservation } = await import('./src/r1/session-index.ts');
      initDb();
      const now = Date.now();
      const iso = ms => new Date(ms).toISOString();
      const link = { kind: 'active', participant_id: 'mm_cto', project: 'mm', role: 'cto', project_role: 'mm/cto' };
      const retired = { ...link, kind: 'retired' };
      const base = {
        vendor: 'codex',
        source_path: '/tmp/session.jsonl',
        raw_event_id: null,
        project: 'mm',
        cwd: '/repo/mm',
        model: 'gpt-5',
        started_at: iso(now - 60 * 60 * 1000),
        last_mtime: 1,
        last_log_line: 'log',
        metadata: '{}',
      };
      const seed = (vendor, session_id, last_activity_at, state, sessionLink = link) => {
        upsertSessionObservation({ ...base, vendor, session_id, last_activity_at, state }, sessionLink);
      };
      seed('claude', 'fresh-working', iso(now - 60 * 1000));
      seed('claude', 'stale-claude', iso(now - 30 * 60 * 1000));
      seed('codex', 'stale-codex', iso(now - 30 * 60 * 1000));
      seed('gemini', 'stale-gemini', iso(now - 30 * 60 * 1000));
      seed('codex', 'explicit-wedged', iso(now - 60 * 1000), 'wedged');
      seed('claude', 'retired-old', iso(now - 60 * 60 * 1000), undefined, retired);
      seed('codex', 'orphan-old', iso(now - 60 * 60 * 1000), undefined, null);

      const pick = rows => rows
        .map(row => ({ session_id: row.session_id, state: row.state }))
        .sort((a, b) => a.session_id.localeCompare(b.session_id));
      console.log(JSON.stringify({
        defaults: pick(listActiveSessions()),
        wedged: pick(listActiveSessions({ states: ['wedged'] })),
        working: pick(listActiveSessions({ states: ['working'] })),
        wedgedLimited: pick(listActiveSessions({ states: ['wedged'], limit: 1 })),
        completed: pick(listActiveSessions({ states: ['completed'] })),
        orphan: pick(listActiveSessions({ states: ['orphan'] })),
        readAll: pick(listActiveSessions({ states: ['working', 'idle', 'wedged', 'completed', 'orphan'] })),
        stored: db.prepare("SELECT vendor, session_id, state FROM session_index ORDER BY session_id").all(),
      }));
      db.close();
    `);
    expect(res.exitCode).toBe(0);
    const body = JSON.parse(new TextDecoder().decode(res.stdout));
    expect(body.defaults).toEqual([
      { session_id: 'explicit-wedged', state: 'wedged' },
      { session_id: 'fresh-working', state: 'working' },
      { session_id: 'stale-claude', state: 'idle' },
      { session_id: 'stale-codex', state: 'idle' },
      { session_id: 'stale-gemini', state: 'idle' },
    ]);
    expect(body.wedged).toEqual([{ session_id: 'explicit-wedged', state: 'wedged' }]);
    expect(body.working).toEqual([{ session_id: 'fresh-working', state: 'working' }]);
    expect(body.wedgedLimited).toEqual([{ session_id: 'explicit-wedged', state: 'wedged' }]);
    expect(body.completed).toEqual([{ session_id: 'retired-old', state: 'completed' }]);
    expect(body.orphan).toEqual([{ session_id: 'orphan-old', state: 'orphan' }]);
    const storedStates = body.stored.map((row: any) => ({ session_id: row.session_id, state: row.state }));
    expect(storedStates).toEqual([
      { session_id: 'explicit-wedged', state: 'wedged' },
      { session_id: 'fresh-working', state: 'working' },
      { session_id: 'orphan-old', state: 'orphan' },
      { session_id: 'retired-old', state: 'completed' },
      { session_id: 'stale-claude', state: 'idle' },
      { session_id: 'stale-codex', state: 'idle' },
      { session_id: 'stale-gemini', state: 'idle' },
    ]);
    expect(body.readAll).toEqual(storedStates);
  });

  test('refresh preserves completed and wedged evidence while retired completion stays terminal', () => {
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`
      INSERT INTO participants (id, project, role, active_session_id) VALUES
        ('mm_completed', 'mm', 'completed', 'sess-explicit-completed'),
        ('mm_wedged', 'mm', 'wedged', 'sess-explicit-wedged'),
        ('mm_retired', 'mm', 'retired', NULL);
      INSERT INTO valhalla_sessions (participant_id, version_n, old_session_id)
      VALUES ('mm_retired', 1, 'sess-retired-completed');
    `);
    acDb.close();

    const res = runEval(`
      const { Database } = await import('bun:sqlite');
      const { initDb, db } = await import('./src/core.ts');
      const { handleActiveTokens } = await import('./src/r1/api.ts');
      const { recordSessionObservation, refreshStoredSessionStates } = await import('./src/r1/session-index.ts');
      initDb();
      const base = {
        vendor: 'claude',
        source_path: '/tmp/terminal.jsonl',
        raw_event_id: null,
        project: 'mm',
        cwd: '/repo/mm',
        model: 'claude-opus',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        last_activity_at: new Date(Date.now() - 1_000).toISOString(),
        last_mtime: 1,
        last_log_line: 'terminal',
        metadata: '{}',
      };
      recordSessionObservation({ ...base, session_id: 'sess-explicit-completed', state: 'completed' });
      recordSessionObservation({ ...base, session_id: 'sess-explicit-wedged', state: 'wedged' });
      recordSessionObservation({ ...base, session_id: 'sess-retired-completed' });
      const acDb = new Database(process.env.MT_AC_DB_PATH);
      acDb.prepare("UPDATE participants SET role = 'completed-renamed' WHERE id = 'mm_completed'").run();
      acDb.close();
      const eventCountBefore = db.prepare('SELECT COUNT(*) AS c FROM session_events').get().c;
      const first = refreshStoredSessionStates('claude', { nowMs: 100_000, intervalSeconds: 30 });
      const gated = refreshStoredSessionStates('claude', { nowMs: 120_000, intervalSeconds: 30 });
      const next = refreshStoredSessionStates('claude', { nowMs: 131_000, intervalSeconds: 30 });
      const states = db.prepare('SELECT session_id, state FROM session_index ORDER BY session_id').all();
      const eventCountAfter = db.prepare('SELECT COUNT(*) AS c FROM session_events').get().c;
      const active = JSON.parse(await handleActiveTokens(new URL('http://localhost/api/v1/tokens/active')).text());
      console.log(JSON.stringify({ first, gated, next, states, eventCountBefore, eventCountAfter, active }));
      db.close();
    `);
    if (res.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(res.stderr));
    }
    const body = JSON.parse(new TextDecoder().decode(res.stdout));
    expect(body.first).toEqual({ ran: true, changed: 1 });
    expect(body.gated).toEqual({ ran: false, changed: 0 });
    expect(body.next).toEqual({ ran: true, changed: 0 });
    expect(body.states).toEqual([
      { session_id: 'sess-explicit-completed', state: 'completed' },
      { session_id: 'sess-explicit-wedged', state: 'wedged' },
      { session_id: 'sess-retired-completed', state: 'completed' },
    ]);
    expect(body.eventCountAfter).toBe(body.eventCountBefore);
    expect(body.active.participants.map((row: any) => row.session_id)).toEqual(['sess-explicit-wedged']);
  });

  test('prompt footer links exact ids and skips legacy footer without synthetic id', () => {
    const res = runEval(`
      const { initDb, db } = await import('./src/core.ts');
      const { recordSessionObservation } = await import('./src/r1/session-index.ts');
      initDb();
      const obs = {
        vendor: 'claude',
        session_id: 'sess-link',
        source_path: '/tmp/sess-link.jsonl',
        raw_event_id: null,
        project: 'mm',
        cwd: '/repo/mm',
        model: 'claude',
        started_at: '2026-04-22T10:00:00Z',
        last_activity_at: '2026-04-22T10:00:01Z',
        last_mtime: 1,
        last_log_line: 'x',
        metadata: '{}',
      };
      recordSessionObservation(obs, 'hello\\n\\n---\\nchain: xii\\nfrom: mm_cto\\nto: mm_devops\\nchain_msg_id: xii-4\\nchain_seq: 4');
      recordSessionObservation({ ...obs, session_id: 'sess-legacy' }, 'hello\\n\\n---\\nchain: old\\nfrom: a\\nto: b');
      db.close();
    `);
    expect(res.exitCode).toBe(0);
    const db = openBrainDb();
    const links = db.prepare(`SELECT chain_msg_id, chain, seq, confidence FROM session_message_links`).all() as any[];
    expect(links).toEqual([{ chain_msg_id: 'xii-4', chain: 'xii', seq: 4, confidence: 'exact' }]);
    db.close();
  });

  test('backfill populates session_index and preserves malformed metadata as orphan', () => {
    const res = runEval(`
      const { initDb, db, upsertRawEvent } = await import('./src/core.ts');
      initDb();
      upsertRawEvent({
        source_type: 'llm_chat',
        project: 'mm',
        external_id: 'claude:sess-good',
        timestamp: '2026-04-22T10:00:00Z',
        content: 'User: hi',
        metadata: JSON.stringify({ provider: 'claude', session_id: 'sess-good', source_path: '/tmp/good.jsonl', started: '2026-04-22T10:00:00Z', ended: '2026-04-22T10:00:01Z' }),
      });
      db.prepare("INSERT INTO raw_events (source_type, project, external_id, timestamp, content, metadata) VALUES ('llm_chat', 'mm', 'codex:sess-bad', '2026-04-22T10:00:00Z', 'User: bad', '{bad json')").run();
      db.prepare("INSERT INTO import_state (source_path, last_mtime, provider, external_id, project, cwd, model, last_user_snippet) VALUES ('/tmp/bad.jsonl', 7, 'codex', 'sess-bad', 'mm', '/repo/mm', 'gpt-5', 'bad')").run();
      db.close();
    `);
    expect(res.exitCode).toBe(0);

    const backfill = Bun.spawnSync({
      cmd: ['bun', 'scripts/backfill-r1.ts'],
      cwd: REPO,
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_AC_DB_PATH: path.join(tmpRoot, 'missing-ac.db') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(backfill.exitCode).toBe(0);
    const db = openBrainDb();
    const rows = db.prepare(`SELECT vendor, session_id, state, orphan_reason FROM session_index ORDER BY vendor`).all() as any[];
    expect(rows).toEqual([
      { vendor: 'claude', session_id: 'sess-good', state: 'orphan', orphan_reason: 'ac_db_unavailable' },
      { vendor: 'codex', session_id: 'sess-bad', state: 'orphan', orphan_reason: 'metadata_parse_error' },
    ]);
    db.close();
  });

  test('Claude importer wires raw_events namespace and session_index row', () => {
    const importRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-claude-import-'));
    fs.mkdirSync(path.join(importRoot, 'raw'), { recursive: true });
    fs.mkdirSync(path.join(importRoot, 'wiki'), { recursive: true });
    fs.mkdirSync(path.join(importRoot, 'meta'), { recursive: true });
    const importAcDbPath = path.join(importRoot, 'ac-msg.db');
    const claudeDir = path.join(importRoot, 'claude-projects');
    const projectDir = path.join(claudeDir, '-Users-test-mm');
    const sessionFile = path.join(projectDir, 'session.jsonl');
    fs.mkdirSync(projectDir, { recursive: true });
    try {
      const writeSession = (secondInputTokens: number) => {
        fs.writeFileSync(sessionFile, [
          JSON.stringify({
            type: 'user',
            sessionId: 'sess-claude-import',
            cwd: '/Users/test/mm',
            timestamp: '2026-04-22T10:00:00Z',
            message: { content: [{ type: 'text', text: 'hello' }] },
          }),
          JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-claude-import',
            cwd: '/Users/test/mm',
            timestamp: '2026-04-22T10:00:01Z',
            message: {
              model: 'claude-opus-4-6',
              usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
              content: [{ type: 'text', text: 'hi' }],
            },
          }),
          JSON.stringify({
            type: 'user',
            sessionId: 'sess-claude-import',
            cwd: '/Users/test/mm',
            timestamp: '2026-04-22T10:00:02Z',
            message: { content: [{ type: 'text', text: 'second' }] },
          }),
          JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-claude-import',
            cwd: '/Users/test/mm',
            timestamp: '2026-04-22T10:00:03Z',
            message: {
              model: 'claude-opus-4-6',
              usage: { input_tokens: secondInputTokens, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 5 },
              content: [{ type: 'text', text: 'done' }],
            },
          }),
        ].join('\n') + '\n');
        const aged = (Date.now() - 10 * 60 * 1000) / 1000;
        fs.utimesSync(sessionFile, aged, aged);
      };
      writeSession(200);

      const acDb = makeAcShapeDb(importAcDbPath);
      acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_devops', 'mm', 'devops', 'sess-claude-import')`);
      acDb.close();

      const imported = Bun.spawnSync({
        cmd: ['bun', 'scripts/import-claude.ts', '--projects-dir', claudeDir, '--days', '365', '--force', '--min-age-seconds', '0'],
        cwd: REPO,
        env: { ...process.env, MT_BRAIN_ROOT: importRoot, MT_AC_DB_PATH: importAcDbPath },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(imported.exitCode).toBe(0);

      const db = new Database(path.join(importRoot, 'meta', 'brain.db'));
      const raw = db.prepare(`SELECT external_id FROM raw_events`).get() as any;
      const session = db.prepare(`SELECT vendor, session_id, participant_id, project_role FROM session_index`).get() as any;
      const usage = db.prepare(`SELECT input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd, pricing_source, cost_breakdown FROM session_usage`).get() as any;
      expect(raw.external_id).toBe('claude:sess-claude-import');
      expect(session).toEqual({
        vendor: 'claude',
        session_id: 'sess-claude-import',
        participant_id: 'mm_devops',
        project_role: 'mm/devops',
      });
      const breakdown = JSON.parse(usage.cost_breakdown);
      delete usage.cost_breakdown;
      expect(usage).toEqual({
        input_tokens: 300,
        output_tokens: 30,
        cached_tokens: 80,
        reasoning_tokens: 0,
        cost_usd: 0.00249125,
        pricing_source: 'pricing.toml',
      });
      expect(breakdown.lines.filter((line: any) => line.type.startsWith('cache'))).toEqual([
        { type: 'cache_creation_5m', tokens: 35, rate: 6.25, cost: 0.00021875 },
        { type: 'cache_creation_1h', tokens: 0, rate: 10, cost: 0 },
        { type: 'cache_read', tokens: 45, rate: 0.5, cost: 0.0000225 },
      ]);

      writeSession(50);
      const reimported = Bun.spawnSync({
        cmd: ['bun', 'scripts/import-claude.ts', '--projects-dir', claudeDir, '--days', '365', '--force', '--min-age-seconds', '0'],
        cwd: REPO,
        env: { ...process.env, MT_BRAIN_ROOT: importRoot, MT_AC_DB_PATH: importAcDbPath },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(reimported.exitCode).toBe(0);
      const recomputed = db.prepare(`SELECT COUNT(*) AS c, input_tokens, output_tokens, cached_tokens FROM session_usage`).get() as any;
      expect(recomputed).toEqual({ c: 1, input_tokens: 150, output_tokens: 30, cached_tokens: 80 });
      db.close();
    } finally {
      fs.rmSync(importRoot, { recursive: true, force: true });
    }
  });

  test('unchanged Claude refresh advances working to idle and active to retired', () => {
    const importRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-claude-refresh-'));
    const importAcDbPath = path.join(importRoot, 'ac-msg.db');
    const claudeDir = path.join(importRoot, 'claude-projects');
    const projectDir = path.join(claudeDir, '-Users-test-mm');
    const sessionFile = path.join(projectDir, 'session.jsonl');
    fs.mkdirSync(projectDir, { recursive: true });

    try {
      const activityAt = new Date(Date.now() - 1_000).toISOString();
      fs.writeFileSync(sessionFile, [
        JSON.stringify({
          type: 'user',
          sessionId: 'sess-claude-refresh',
          cwd: '/Users/test/mm',
          timestamp: activityAt,
          message: { content: [{ type: 'text', text: 'first' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId: 'sess-claude-refresh',
          cwd: '/Users/test/mm',
          timestamp: activityAt,
          message: { model: 'claude-opus-4-6', content: [{ type: 'text', text: 'reply' }] },
        }),
        JSON.stringify({
          type: 'user',
          sessionId: 'sess-claude-refresh',
          cwd: '/Users/test/mm',
          timestamp: activityAt,
          message: { content: [{ type: 'text', text: 'second' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId: 'sess-claude-refresh',
          cwd: '/Users/test/mm',
          timestamp: activityAt,
          message: { model: 'claude-opus-4-6', content: [{ type: 'text', text: 'done' }] },
        }),
      ].join('\n') + '\n');
      const settledMtime = (Date.now() - 10 * 60 * 1000) / 1000;
      fs.utimesSync(sessionFile, settledMtime, settledMtime);
      const originalMtime = fs.statSync(sessionFile).mtimeMs;

      const acDb = makeAcShapeDb(importAcDbPath);
      acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_devops', 'mm', 'devops', 'sess-claude-refresh')`);
      acDb.close();

      const runImporter = (idleSeconds: string) => Bun.spawnSync({
        cmd: ['bun', 'scripts/import-claude.ts', '--projects-dir', claudeDir, '--days', '365', '--min-age-seconds', '0'],
        cwd: REPO,
        env: {
          ...process.env,
          MT_BRAIN_ROOT: importRoot,
          MT_AC_DB_PATH: importAcDbPath,
          MT_R1_IDLE_SECONDS: idleSeconds,
          MT_R1_STATE_REFRESH_SECONDS: '0',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const first = runImporter('3600');
      expect(first.exitCode).toBe(0);
      let db = new Database(path.join(importRoot, 'meta', 'brain.db'));
      expect((db.prepare(`SELECT state FROM session_index WHERE session_id = 'sess-claude-refresh'`).get() as any).state).toBe('working');
      db.close();

      const second = runImporter('0');
      expect(second.exitCode).toBe(0);
      expect(new TextDecoder().decode(second.stdout)).toContain('skipped (unchanged): 1');
      expect(new TextDecoder().decode(second.stdout)).toContain('state refresh:     1 changed');
      expect(fs.statSync(sessionFile).mtimeMs).toBe(originalMtime);
      db = new Database(path.join(importRoot, 'meta', 'brain.db'));
      expect((db.prepare(`SELECT state FROM session_index WHERE session_id = 'sess-claude-refresh'`).get() as any).state).toBe('idle');
      db.close();

      const retiredAcDb = new Database(importAcDbPath);
      retiredAcDb.exec(`
        UPDATE participants SET active_session_id = NULL WHERE id = 'mm_devops';
        INSERT INTO valhalla_sessions (participant_id, version_n, old_session_id)
        VALUES ('mm_devops', 1, 'sess-claude-refresh');
      `);
      retiredAcDb.close();

      const third = runImporter('0');
      expect(third.exitCode).toBe(0);
      expect(new TextDecoder().decode(third.stdout)).toContain('skipped (unchanged): 1');
      expect(new TextDecoder().decode(third.stdout)).toContain('state refresh:     1 changed');
      expect(fs.statSync(sessionFile).mtimeMs).toBe(originalMtime);

      const activeTokens = Bun.spawnSync({
        cmd: ['bun', '-e', `
          const { initDb, db } = await import('./src/core.ts');
          const { handleActiveTokens } = await import('./src/r1/api.ts');
          initDb();
          const response = handleActiveTokens(new URL('http://localhost/api/v1/tokens/active'));
          console.log(await response.text());
          db.close();
        `],
        cwd: REPO,
        env: { ...process.env, MT_BRAIN_ROOT: importRoot, MT_AC_DB_PATH: importAcDbPath },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(activeTokens.exitCode).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(activeTokens.stdout)).participants).toEqual([]);

      db = new Database(path.join(importRoot, 'meta', 'brain.db'));
      expect((db.prepare(`SELECT state FROM session_index WHERE session_id = 'sess-claude-refresh'`).get() as any).state).toBe('completed');
      expect(db.prepare(`SELECT event_type FROM session_events ORDER BY id`).all()).toEqual([
        { event_type: 'session_started' },
        { event_type: 'session_idle' },
        { event_type: 'session_completed' },
      ]);
      db.close();
    } finally {
      fs.rmSync(importRoot, { recursive: true, force: true });
    }
  });

  test('Codex importer reads model from turn_context and prices cached tokens once', () => {
    const importRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-import-codex-'));
    const importAcDbPath = path.join(importRoot, 'ac-msg.db');
    const codexDir = path.join(importRoot, 'codex-sessions');
    const dayDir = path.join(codexDir, '2026', '04', '22');
    const sessionFile = path.join(dayDir, 'rollout-codex-modern.jsonl');
    fs.mkdirSync(dayDir, { recursive: true });

    try {
      fs.writeFileSync(sessionFile, [
        {
          timestamp: '2026-04-22T10:00:00Z',
          type: 'session_meta',
          payload: { id: 'sess-codex-import', cwd: '/Users/test/work/mm' },
        },
        {
          timestamp: '2026-04-22T10:00:01Z',
          type: 'turn_context',
          payload: { cwd: '/Users/test/work/mm', model: 'gpt-5.4' },
        },
        {
          timestamp: '2026-04-22T10:00:02Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello codex' },
        },
        {
          timestamp: '2026-04-22T10:00:03Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'hello user' }],
          },
        },
        {
          timestamp: '2026-04-22T10:00:04Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 1000,
                cached_input_tokens: 200,
                output_tokens: 50,
                reasoning_output_tokens: 10,
                total_tokens: 1050,
              },
            },
          },
        },
      ].map(row => JSON.stringify(row)).join('\n') + '\n');
      const aged = (Date.now() - 10 * 60 * 1000) / 1000;
      fs.utimesSync(sessionFile, aged, aged);

      const acDb = makeAcShapeDb(importAcDbPath);
      acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_devops', 'mm', 'devops', 'sess-codex-import')`);
      acDb.close();

      const imported = Bun.spawnSync({
        cmd: ['bun', 'scripts/import-codex.ts', '--sessions-dir', codexDir, '--days', '365', '--force', '--min-turns', '1', '--min-age-seconds', '0'],
        cwd: REPO,
        env: { ...process.env, MT_BRAIN_ROOT: importRoot, MT_AC_DB_PATH: importAcDbPath },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(imported.exitCode).toBe(0);

      const db = new Database(path.join(importRoot, 'meta', 'brain.db'));
      const session = db.prepare(`SELECT vendor, session_id, participant_id, model FROM session_index`).get() as any;
      const usage = db.prepare(`SELECT input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd, pricing_source, cost_breakdown FROM session_usage`).get() as any;
      expect(session).toEqual({
        vendor: 'codex',
        session_id: 'sess-codex-import',
        participant_id: 'mm_devops',
        model: 'gpt-5.4',
      });
      const breakdown = JSON.parse(usage.cost_breakdown);
      delete usage.cost_breakdown;
      expect(usage).toEqual({
        input_tokens: 1000,
        output_tokens: 50,
        cached_tokens: 200,
        reasoning_tokens: 10,
        cost_usd: 0.0028,
        pricing_source: 'pricing.toml',
      });
      expect(breakdown.lines).toEqual([
        { type: 'input', tokens: 800, rate: 2.5, cost: 0.002 },
        { type: 'cached', tokens: 200, rate: 0.25, cost: 0.00005 },
        { type: 'output', tokens: 50, rate: 15, cost: 0.00075 },
      ]);
      db.close();
    } finally {
      fs.rmSync(importRoot, { recursive: true, force: true });
    }
  });

  test('backfill migrates old raw_events external_id before changed importer pass', () => {
    const claudeDir = path.join(tmpRoot, 'claude-projects');
    const projectDir = path.join(claudeDir, '-Users-test-mm');
    const sessionFile = path.join(projectDir, 'sess-upgrade.jsonl');
    fs.mkdirSync(projectDir, { recursive: true });

    const writeClaudeFixture = (includeNewTurn: boolean) => {
      const rows = [
        {
          type: 'user',
          sessionId: 'sess-upgrade',
          cwd: '/Users/test/mm',
          timestamp: '2026-04-22T10:00:00Z',
          message: { content: [{ type: 'text', text: 'old user' }] },
        },
        {
          type: 'assistant',
          sessionId: 'sess-upgrade',
          cwd: '/Users/test/mm',
          timestamp: '2026-04-22T10:00:01Z',
          message: { model: 'claude-opus', content: [{ type: 'text', text: 'old assistant' }] },
        },
        {
          type: 'user',
          sessionId: 'sess-upgrade',
          cwd: '/Users/test/mm',
          timestamp: '2026-04-22T10:00:02Z',
          message: { content: [{ type: 'text', text: includeNewTurn ? 'new user UNIQUE_UPGRADE' : 'second old user' }] },
        },
        {
          type: 'assistant',
          sessionId: 'sess-upgrade',
          cwd: '/Users/test/mm',
          timestamp: '2026-04-22T10:00:03Z',
          message: { model: 'claude-opus', content: [{ type: 'text', text: includeNewTurn ? 'new assistant' : 'second old assistant' }] },
        },
      ];
      fs.writeFileSync(sessionFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      const aged = (Date.now() - 10 * 60 * 1000) / 1000;
      fs.utimesSync(sessionFile, aged, aged);
    };

    writeClaudeFixture(false);
    const seed = runEval(`
      const { initDb, db } = await import('./src/core.ts');
      initDb();
      db.prepare("INSERT INTO raw_events (source_type, project, external_id, timestamp, content, title, metadata, processed, chunked) VALUES ('llm_chat', 'mm', 'sess-upgrade', '2026-04-22T10:00:00Z', 'User: old user', 'Old', ?, 1, 1)").run(JSON.stringify({
        provider: 'claude',
        session_id: 'sess-upgrade',
        source_path: ${JSON.stringify(sessionFile)},
        model: 'claude-opus',
        cwd: '/Users/test/mm',
        started: '2026-04-22T10:00:00Z',
        ended: '2026-04-22T10:00:01Z'
      }));
      db.prepare("INSERT INTO events_fts (external_id, project, source_type, title, content) VALUES ('sess-upgrade', 'mm', 'llm_chat', 'Old', 'User: old user')").run();
      db.prepare("INSERT INTO import_state (source_path, last_mtime, provider, external_id, project, cwd, model, last_user_snippet, min_turns_ok) VALUES (?, 1, 'claude', 'sess-upgrade', 'mm', '/Users/test/mm', 'claude-opus', 'old user', 1)").run(${JSON.stringify(sessionFile)});
      db.close();
    `);
    expect(seed.exitCode).toBe(0);

    const backfill = Bun.spawnSync({
      cmd: ['bun', 'scripts/backfill-r1.ts'],
      cwd: REPO,
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_AC_DB_PATH: path.join(tmpRoot, 'missing-ac.db') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(backfill.exitCode).toBe(0);
    const backfillSummary = JSON.parse(new TextDecoder().decode(backfill.stdout));
    expect(backfillSummary.migrated_external_ids).toBe(1);

    writeClaudeFixture(true);
    const imported = Bun.spawnSync({
      cmd: ['bun', 'scripts/import-claude.ts', '--projects-dir', claudeDir, '--days', '365', '--min-age-seconds', '0'],
      cwd: REPO,
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_AC_DB_PATH: path.join(tmpRoot, 'missing-ac.db') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(imported.exitCode).toBe(0);

    const db = openBrainDb();
    const rawEvents = db.prepare(
      `SELECT id, external_id, CASE WHEN instr(content, 'UNIQUE_UPGRADE') > 0 THEN 1 ELSE 0 END AS has_new, processed, chunked
       FROM raw_events ORDER BY id`
    ).all() as any[];
    const ftsRows = db.prepare(`SELECT external_id FROM events_fts ORDER BY external_id`).all() as any[];
    const session = db.prepare(
      `SELECT vendor, session_id, raw_event_id FROM session_index WHERE vendor = 'claude' AND session_id = 'sess-upgrade'`
    ).get() as any;
    db.close();

    expect(rawEvents).toEqual([
      { id: 1, external_id: 'claude:sess-upgrade', has_new: 1, processed: 0, chunked: 0 },
    ]);
    expect(ftsRows).toEqual([{ external_id: 'claude:sess-upgrade' }]);
    expect(session).toEqual({ vendor: 'claude', session_id: 'sess-upgrade', raw_event_id: 1 });
  });

  test('backfill merges old unprefixed row when prefixed duplicate already exists', () => {
    const seed = runEval(`
      const { initDb, db } = await import('./src/core.ts');
      initDb();
      db.prepare("INSERT INTO wiki_pages (slug, title) VALUES ('Upgrade', 'Upgrade')").run();
      const claim = db.prepare("INSERT INTO claims (wiki_slug, claim_text) VALUES ('Upgrade', 'upgrade claim')").run();
      db.prepare("INSERT INTO raw_events (source_type, project, external_id, timestamp, content, title, metadata) VALUES ('llm_chat', 'mm', 'sess-collision', '2026-04-22T10:00:00Z', 'old content', 'Old', ?)").run(JSON.stringify({
        provider: 'claude',
        session_id: 'sess-collision',
        source_path: '/tmp/collision.jsonl',
        started: '2026-04-22T10:00:00Z',
        ended: '2026-04-22T10:00:01Z'
      }));
      db.prepare("INSERT INTO raw_events (source_type, project, external_id, timestamp, content, title, metadata) VALUES ('llm_chat', 'mm', 'claude:sess-collision', '2026-04-22T10:00:02Z', 'new content', 'New', ?)").run(JSON.stringify({
        provider: 'claude',
        session_id: 'sess-collision',
        source_path: '/tmp/collision.jsonl',
        started: '2026-04-22T10:00:00Z',
        ended: '2026-04-22T10:00:02Z'
      }));
      db.prepare("INSERT INTO events_fts (external_id, project, source_type, title, content) VALUES ('sess-collision', 'mm', 'llm_chat', 'Old', 'old content')").run();
      db.prepare("INSERT INTO events_fts (external_id, project, source_type, title, content) VALUES ('claude:sess-collision', 'mm', 'llm_chat', 'New', 'new content')").run();
      db.prepare("INSERT INTO claim_sources_event (claim_id, event_id) VALUES (?, 1)").run(claim.lastInsertRowid);
      db.prepare("INSERT INTO import_state (source_path, last_mtime, provider, external_id, project, cwd, model, last_user_snippet, min_turns_ok) VALUES ('/tmp/collision.jsonl', 1, 'claude', 'sess-collision', 'mm', '/repo/mm', 'claude-opus', 'old', 1)").run();
      db.close();
    `);
    expect(seed.exitCode).toBe(0);

    const backfill = Bun.spawnSync({
      cmd: ['bun', 'scripts/backfill-r1.ts'],
      cwd: REPO,
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_AC_DB_PATH: path.join(tmpRoot, 'missing-ac.db') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(backfill.exitCode).toBe(0);
    const summary = JSON.parse(new TextDecoder().decode(backfill.stdout));
    expect(summary.merged_collisions).toBe(1);

    const db = openBrainDb();
    const rawEvents = db.prepare(`SELECT id, external_id, content FROM raw_events ORDER BY id`).all() as any[];
    const ftsRows = db.prepare(`SELECT external_id FROM events_fts ORDER BY external_id`).all() as any[];
    const source = db.prepare(`SELECT event_id FROM claim_sources_event`).get() as any;
    const session = db.prepare(
      `SELECT raw_event_id FROM session_index WHERE vendor = 'claude' AND session_id = 'sess-collision'`
    ).get() as any;
    db.close();

    expect(rawEvents).toEqual([{ id: 2, external_id: 'claude:sess-collision', content: 'new content' }]);
    expect(ftsRows).toEqual([{ external_id: 'claude:sess-collision' }]);
    expect(source.event_id).toBe(2);
    expect(session.raw_event_id).toBe(2);
  });
});

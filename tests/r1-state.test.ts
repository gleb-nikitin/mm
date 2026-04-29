import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deriveSessionState, eventTypeForStateChange } from '../src/r1/session-state.ts';

const REPO = path.resolve(import.meta.dir, '..');

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-state-'));
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(root, 'wiki'), { recursive: true });
  fs.mkdirSync(path.join(root, 'meta'), { recursive: true });
  return root;
}

function makeAcDb(filePath: string, sessionId: string): void {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE participants (id TEXT PRIMARY KEY, project TEXT, role TEXT, active_session_id TEXT);
    INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_devops', 'mm', 'devops', '${sessionId}');
  `);
  db.close();
}

function runEval(root: string, acDb: string, code: string) {
  return Bun.spawnSync({
    cmd: ['bun', '-e', code],
    cwd: REPO,
    env: { ...process.env, MT_BRAIN_ROOT: root, MT_AC_DB_PATH: acDb },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('R1 session state derivation', () => {
  test('thresholds derive working, idle, wedged, completed, and orphan states', () => {
    const nowMs = Date.parse('2026-04-22T10:20:00Z');
    expect(deriveSessionState({ linked: true, last_activity_at: '2026-04-22T10:19:00Z', nowMs })).toBe('working');
    expect(deriveSessionState({ linked: true, last_activity_at: '2026-04-22T10:14:59Z', nowMs })).toBe('idle');
    expect(deriveSessionState({ linked: true, last_activity_at: '2026-04-22T10:04:59Z', nowMs })).toBe('wedged');
    expect(deriveSessionState({ linked: true, completed: true, last_activity_at: '2026-04-22T10:19:00Z', nowMs })).toBe('completed');
    expect(deriveSessionState({ linked: false, last_activity_at: '2026-04-22T10:19:00Z', nowMs })).toBe('orphan');
  });

  test('state changes map to lifecycle event types', () => {
    expect(eventTypeForStateChange(null, 'idle')).toBe('session_started');
    expect(eventTypeForStateChange('idle', 'working')).toBe('session_active');
    expect(eventTypeForStateChange('working', 'idle')).toBe('session_idle');
    expect(eventTypeForStateChange('idle', 'wedged')).toBe('session_wedged');
    expect(eventTypeForStateChange('working', 'completed')).toBe('session_completed');
    expect(eventTypeForStateChange('working', 'orphan')).toBe('session_orphaned');
    expect(eventTypeForStateChange('idle', 'idle')).toBeNull();
  });

  test('records all event types and skips unchanged state', () => {
    const root = makeRoot();
    const acDb = path.join(root, 'ac.db');
    makeAcDb(acDb, 'sess-flow');
    try {
      const res = runEval(root, acDb, `
        const { initDb, db } = await import('./src/core.ts');
        const { recordSessionObservation } = await import('./src/r1/session-index.ts');
        initDb();
        const obs = (last_activity_at, extra = {}) => ({
          vendor: 'codex',
          session_id: 'sess-flow',
          source_path: '/tmp/sess-flow.jsonl',
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: 'gpt-5',
          started_at: '2026-04-22T10:00:00Z',
          last_activity_at,
          last_mtime: 1,
          last_log_line: last_activity_at,
          metadata: '{}',
          ...extra,
        });
        const recent = new Date(Date.now() - 60_000).toISOString();
        const idle = new Date(Date.now() - 360_000).toISOString();
        const wedged = new Date(Date.now() - 960_000).toISOString();
        recordSessionObservation(obs(recent));
        recordSessionObservation(obs(recent));
        recordSessionObservation(obs(idle));
        recordSessionObservation(obs(wedged));
        recordSessionObservation(obs(recent));
        recordSessionObservation(obs(recent, { state: 'completed' }));
        db.close();
      `);
      expect(res.exitCode).toBe(0);

      const ac = new Database(acDb);
      ac.prepare(`UPDATE participants SET active_session_id = null WHERE id = 'mm_devops'`).run();
      ac.close();

      const orphan = runEval(root, acDb, `
        const { initDb, db } = await import('./src/core.ts');
        const { recordSessionObservation } = await import('./src/r1/session-index.ts');
        initDb();
        recordSessionObservation({
          vendor: 'codex',
          session_id: 'sess-flow',
          source_path: '/tmp/sess-flow.jsonl',
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: 'gpt-5',
          started_at: '2026-04-22T10:00:00Z',
          last_activity_at: new Date().toISOString(),
          last_mtime: 1,
          last_log_line: 'orphan',
          metadata: '{}',
        });
        db.close();
      `);
      expect(orphan.exitCode).toBe(0);

      const check = new Database(path.join(root, 'meta', 'brain.db'));
      const rows = check.prepare(`SELECT event_type, json_extract(payload, '$.state') AS state FROM session_events ORDER BY id`).all() as any[];
      check.close();
      expect(rows).toEqual([
        { event_type: 'session_started', state: 'working' },
        { event_type: 'session_idle', state: 'idle' },
        { event_type: 'session_wedged', state: 'wedged' },
        { event_type: 'session_active', state: 'working' },
        { event_type: 'session_completed', state: 'completed' },
        { event_type: 'session_orphaned', state: 'orphan' },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('first observation emits only session_started with derived state payload', () => {
    const root = makeRoot();
    const acDb = path.join(root, 'ac.db');
    makeAcDb(acDb, 'sess-first-idle');
    try {
      const res = runEval(root, acDb, `
        const { initDb, db } = await import('./src/core.ts');
        const { recordSessionObservation } = await import('./src/r1/session-index.ts');
        initDb();
        recordSessionObservation({
          vendor: 'codex',
          session_id: 'sess-first-idle',
          source_path: '/tmp/sess-first-idle.jsonl',
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: 'gpt-5',
          started_at: '2026-04-22T10:00:00Z',
          last_activity_at: new Date(Date.now() - 360_000).toISOString(),
          last_mtime: 1,
          last_log_line: 'idle first',
          metadata: '{}',
        });
        recordSessionObservation({
          vendor: 'codex',
          session_id: 'sess-first-orphan',
          source_path: '/tmp/sess-first-orphan.jsonl',
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: 'gpt-5',
          started_at: '2026-04-22T10:00:00Z',
          last_activity_at: new Date().toISOString(),
          last_mtime: 1,
          last_log_line: 'orphan first',
          metadata: '{}',
        });
        db.close();
      `);
      expect(res.exitCode).toBe(0);
      const db = new Database(path.join(root, 'meta', 'brain.db'));
      const rows = db.prepare(`SELECT event_type, session_id, json_extract(payload, '$.state') AS state FROM session_events ORDER BY id`).all() as any[];
      db.close();
      expect(rows).toEqual([
        { event_type: 'session_started', session_id: 'sess-first-idle', state: 'idle' },
        { event_type: 'session_started', session_id: 'sess-first-orphan', state: 'orphan' },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('parallel observations produce one transition event for one state change', async () => {
    const root = makeRoot();
    const acDb = path.join(root, 'ac.db');
    makeAcDb(acDb, 'sess-race');
    const base = `
      const { initDb, db } = await import('./src/core.ts');
      const { recordSessionObservation } = await import('./src/r1/session-index.ts');
      initDb();
      recordSessionObservation({
        vendor: 'codex',
        session_id: 'sess-race',
        source_path: '/tmp/sess-race.jsonl',
        raw_event_id: null,
        project: 'mm',
        cwd: '/repo/mm',
        model: 'gpt-5',
        started_at: '2026-04-22T10:00:00Z',
        last_activity_at: new Date(Date.now() - 60_000).toISOString(),
        last_mtime: 1,
        last_log_line: 'working',
        metadata: '{}',
      });
      db.close();
    `;
    try {
      expect(runEval(root, acDb, base).exitCode).toBe(0);
      const transition = `
        const { initDb, db } = await import('./src/core.ts');
        const { recordSessionObservation } = await import('./src/r1/session-index.ts');
        initDb();
        recordSessionObservation({
          vendor: 'codex',
          session_id: 'sess-race',
          source_path: '/tmp/sess-race.jsonl',
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: 'gpt-5',
          started_at: '2026-04-22T10:00:00Z',
          last_activity_at: new Date(Date.now() - 360_000).toISOString(),
          last_mtime: 2,
          last_log_line: 'idle',
          metadata: '{}',
        });
        db.close();
      `;
      const a = Bun.spawn(['bun', '-e', transition], { cwd: REPO, env: { ...process.env, MT_BRAIN_ROOT: root, MT_AC_DB_PATH: acDb } });
      const b = Bun.spawn(['bun', '-e', transition], { cwd: REPO, env: { ...process.env, MT_BRAIN_ROOT: root, MT_AC_DB_PATH: acDb } });
      expect(await a.exited).toBe(0);
      expect(await b.exited).toBe(0);

      const db = new Database(path.join(root, 'meta', 'brain.db'));
      const count = (db.prepare(`SELECT COUNT(*) AS c FROM session_events WHERE event_type = 'session_idle'`).get() as any).c;
      db.close();
      expect(count).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

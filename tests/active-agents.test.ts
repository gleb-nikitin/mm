import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveParticipantIds } from '../src/core';

let tmpDir: string;
let savedEnv: string | undefined;

function makeAcShapeDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    role TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE llm_sessions (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL REFERENCES participants(id),
    is_active INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

describe('resolveParticipantIds', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-active-agents-'));
    savedEnv = process.env.MT_AC_DB_PATH;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MT_AC_DB_PATH;
    else process.env.MT_AC_DB_PATH = savedEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('resolves active session id to participant_id', () => {
    const acDbPath = path.join(tmpDir, 'msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role) VALUES ('mm_cto', 'mm', 'cto')`);
    acDb.exec(`INSERT INTO llm_sessions (id, participant_id, is_active) VALUES ('sess-active-1', 'mm_cto', 1)`);
    acDb.close();

    process.env.MT_AC_DB_PATH = acDbPath;
    const out = resolveParticipantIds(['sess-active-1']);
    expect(out.get('sess-active-1')).toBe('mm_cto');
    expect(out.size).toBe(1);
  });

  test('ignores inactive sessions', () => {
    const acDbPath = path.join(tmpDir, 'msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role) VALUES ('mm_cto', 'mm', 'cto')`);
    acDb.exec(`INSERT INTO llm_sessions (id, participant_id, is_active) VALUES ('sess-old', 'mm_cto', 0)`);
    acDb.close();

    process.env.MT_AC_DB_PATH = acDbPath;
    const out = resolveParticipantIds(['sess-old']);
    expect(out.size).toBe(0);
  });

  test('returns empty map when ac db file is missing', () => {
    process.env.MT_AC_DB_PATH = path.join(tmpDir, 'does-not-exist.db');
    const out = resolveParticipantIds(['anything']);
    expect(out.size).toBe(0);
  });

  test('returns empty map when no external ids passed', () => {
    const out = resolveParticipantIds([]);
    expect(out.size).toBe(0);
  });

  test('partial resolution: unknown ids are simply absent', () => {
    const acDbPath = path.join(tmpDir, 'msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role) VALUES ('mm_cto', 'mm', 'cto')`);
    acDb.exec(`INSERT INTO llm_sessions (id, participant_id, is_active) VALUES ('sess-known', 'mm_cto', 1)`);
    acDb.close();

    process.env.MT_AC_DB_PATH = acDbPath;
    const out = resolveParticipantIds(['sess-known', 'sess-unknown']);
    expect(out.get('sess-known')).toBe('mm_cto');
    expect(out.has('sess-unknown')).toBe(false);
  });
});

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveParticipantIds, resolveParticipantIdsWithStatus, resolveAcDbPath } from '../src/core';
import { getActiveAgentsLive } from '../src/session-probe';
import { reportAcDbStatus, type AcDbStatus } from '../src/ac-db.ts';

let tmpDir: string;
let savedEnv: string | undefined;

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
    acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', 'sess-active-1')`);
    acDb.close();

    process.env.MT_AC_DB_PATH = acDbPath;
    const out = resolveParticipantIds(['sess-active-1']);
    expect(out.get('sess-active-1')).toBe('mm_cto');
    expect(out.size).toBe(1);
  });

  test('ignores participants without active_session_id', () => {
    const acDbPath = path.join(tmpDir, 'msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', null)`);
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

  test('validates ac schema even when no external ids are passed', () => {
    const wrongSchemaPath = path.join(tmpDir, 'wrong-schema.db');
    const wrongDb = new Database(wrongSchemaPath);
    wrongDb.exec('CREATE TABLE unrelated (id TEXT)');
    wrongDb.close();
    process.env.MT_AC_DB_PATH = wrongSchemaPath;

    const out = resolveParticipantIdsWithStatus([]);
    expect(out.participantIds.size).toBe(0);
    expect(out.acDbStatus).toMatchObject({
      status: 'unreadable',
      source: 'mt_ac_db_path',
      path: wrongSchemaPath,
    });
    expect(out.acDbStatus.message).toContain('no such table');
  });

  test('partial resolution: unknown ids are simply absent', () => {
    const acDbPath = path.join(tmpDir, 'msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', 'sess-known')`);
    acDb.close();

    process.env.MT_AC_DB_PATH = acDbPath;
    const out = resolveParticipantIds(['sess-known', 'sess-unknown']);
    expect(out.get('sess-known')).toBe('mm_cto');
    expect(out.has('sess-unknown')).toBe(false);
  });

  test('resolves old_session_id via valhalla_sessions', () => {
    const acDbPath = path.join(tmpDir, 'msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`
      INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', null);
      INSERT INTO valhalla_sessions (participant_id, version_n, old_session_id) VALUES ('mm_cto', 1, 'sess-old');
    `);
    acDb.close();

    process.env.MT_AC_DB_PATH = acDbPath;
    const out = resolveParticipantIds(['sess-old']);
    expect(out.get('sess-old')).toBe('mm_cto');
    expect(out.size).toBe(1);
  });
});

// ---------- resolveAcDbPath (path precedence) ----------

describe('resolveAcDbPath', () => {
  let pathTmp: string;
  let savedPathEnv: string | undefined;
  beforeEach(() => {
    pathTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-ac-db-path-'));
    savedPathEnv = process.env.MT_AC_DB_PATH;
    delete process.env.MT_AC_DB_PATH;
  });
  afterEach(() => {
    if (savedPathEnv === undefined) delete process.env.MT_AC_DB_PATH;
    else process.env.MT_AC_DB_PATH = savedPathEnv;
    fs.rmSync(pathTmp, { recursive: true, force: true });
  });

  test('MT_AC_DB_PATH resolves the configured database', () => {
    const envOverride = path.join(pathTmp, 'override.db');
    makeAcShapeDb(envOverride).close();
    const resolved = resolveAcDbPath({
      env: { MT_AC_DB_PATH: envOverride },
    });
    expect(resolved).toEqual({
      status: 'available',
      source: 'mt_ac_db_path',
      path: envOverride,
      message: null,
    });
  });

  test('configured MT_AC_DB_PATH that does not exist is distinguishably missing', () => {
    const missing = path.join(pathTmp, 'missing.db');
    const resolved = resolveAcDbPath({ env: { MT_AC_DB_PATH: missing } });
    expect(resolved.status).toBe('missing');
    expect(resolved.source).toBe('mt_ac_db_path');
    expect(resolved.path).toBe(missing);
    expect(resolved.message).toContain('does not exist');
  });

  test('no MT_AC_DB_PATH is unresolved even if AURORA_DATA is present', () => {
    const resolved = resolveAcDbPath({ env: { AURORA_DATA: pathTmp } });
    expect(resolved).toEqual({
      status: 'unresolved',
      source: null,
      path: null,
      message: 'Aurora database is not configured; set MT_AC_DB_PATH',
    });
  });

  test('no configured path is unresolved without discovering developer DBs', () => {
    expect(resolveAcDbPath({ env: {} })).toMatchObject({
      status: 'unresolved',
      source: null,
      path: null,
    });
  });

  test('failure logging deduplicates until a validated recovery', () => {
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);
    const available: AcDbStatus = {
      status: 'available',
      source: 'mt_ac_db_path',
      path: '/validated/msg.db',
      message: null,
    };
    const unreadable: AcDbStatus = {
      status: 'unreadable',
      source: 'mt_ac_db_path',
      path: '/broken/msg.db',
      message: 'Aurora database could not be read',
    };

    reportAcDbStatus(available, write);
    reportAcDbStatus(unreadable, write);
    reportAcDbStatus(unreadable, write);
    expect(lines).toHaveLength(1);

    reportAcDbStatus(available, write);
    reportAcDbStatus(unreadable, write);
    expect(lines).toHaveLength(2);
  });

  test('integration: resolveParticipantIds reads through MT_AC_DB_PATH', () => {
    const configuredPath = path.join(pathTmp, 'configured.db');
    const configuredDb = makeAcShapeDb(configuredPath);
    configuredDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', 'sess-configured')`);
    configuredDb.close();
    process.env.MT_AC_DB_PATH = configuredPath;
    const out = resolveParticipantIds(['sess-configured']);
    expect(out.get('sess-configured')).toBe('mm_cto');
  });
});

// ---------- LIVE PROBE ----------

function writeClaudeSession(
  projectsDir: string,
  projectSlug: string,
  fileName: string,
  sessionId: string,
  cwd: string,
  opts: { model?: string; userTurns?: number; lastUserText?: string; lastAssistantText?: string | null }
) {
  const projDir = path.join(projectsDir, projectSlug);
  fs.mkdirSync(projDir, { recursive: true });
  const lines: string[] = [];
  const userCount = opts.userTurns ?? 2;
  for (let i = 0; i < userCount; i++) {
    const isLast = i === userCount - 1;
    const text = isLast && opts.lastUserText ? opts.lastUserText : `user turn ${i + 1}`;
    lines.push(JSON.stringify({
      type: 'user',
      sessionId,
      cwd,
      timestamp: `2026-04-22T19:30:0${i}Z`,
      message: { content: [{ type: 'text', text }] },
    }));
    const aText = isLast && opts.lastAssistantText !== null
      ? (opts.lastAssistantText ?? `assistant reply ${i + 1}`)
      : `assistant reply ${i + 1}`;
    if (aText) {
      lines.push(JSON.stringify({
        type: 'assistant',
        sessionId,
        cwd,
        timestamp: `2026-04-22T19:30:0${i}.5Z`,
        message: { model: opts.model ?? 'claude-opus-4-6', content: [{ type: 'text', text: aText }] },
      }));
    }
  }
  fs.writeFileSync(path.join(projDir, fileName), lines.join('\n') + '\n');
}

function writeCodexSession(
  sessionsDir: string,
  relDir: string,
  fileName: string,
  sessionId: string,
  cwd: string,
  opts: { model?: string; userTurns?: number; lastUserText?: string }
) {
  const dir = path.join(sessionsDir, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  lines.push(JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-04-22T19:30:00Z',
    payload: { id: sessionId, cwd, model: opts.model ?? 'gpt-5' },
  }));
  const userCount = opts.userTurns ?? 2;
  for (let i = 0; i < userCount; i++) {
    const isLast = i === userCount - 1;
    lines.push(JSON.stringify({
      type: 'event_msg',
      timestamp: `2026-04-22T19:31:0${i}Z`,
      payload: { type: 'user_message', message: isLast && opts.lastUserText ? opts.lastUserText : `codex user ${i + 1}` },
    }));
    lines.push(JSON.stringify({
      type: 'response_item',
      timestamp: `2026-04-22T19:31:0${i}.5Z`,
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `codex reply ${i + 1}` }] },
    }));
  }
  fs.writeFileSync(path.join(dir, fileName), lines.join('\n') + '\n');
}

function writeGeminiSession(
  sessionsDir: string,
  project: string,
  fileName: string,
  sessionId: string,
  opts: { model?: string; userTurns?: number; lastUserText?: string }
) {
  const chatsDir = path.join(sessionsDir, project, 'chats');
  fs.mkdirSync(chatsDir, { recursive: true });
  const messages: any[] = [];
  const userCount = opts.userTurns ?? 2;
  for (let i = 0; i < userCount; i++) {
    const isLast = i === userCount - 1;
    messages.push({
      type: 'user',
      timestamp: `2026-04-22T19:32:0${i}Z`,
      content: [{ text: isLast && opts.lastUserText ? opts.lastUserText : `gemini user ${i + 1}` }],
    });
    messages.push({
      type: 'gemini',
      timestamp: `2026-04-22T19:32:0${i}.5Z`,
      model: opts.model ?? 'gemini-2.5',
      content: `gemini reply ${i + 1}`,
    });
  }
  fs.writeFileSync(path.join(chatsDir, fileName), JSON.stringify({
    sessionId,
    startTime: '2026-04-22T19:32:00Z',
    lastUpdated: '2026-04-22T19:32:10Z',
    messages,
  }));
}

describe('getActiveAgentsLive', () => {
  let probeTmp: string;
  let savedCodexSessionsEnv: string | undefined;
  beforeEach(() => {
    probeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-live-probe-'));
    savedEnv = process.env.MT_AC_DB_PATH;
    savedCodexSessionsEnv = process.env.MT_CODEX_SESSIONS_DIR;
    // Isolate from real ac db lookups
    process.env.MT_AC_DB_PATH = path.join(probeTmp, 'no-ac.db');
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MT_AC_DB_PATH;
    else process.env.MT_AC_DB_PATH = savedEnv;
    if (savedCodexSessionsEnv === undefined) delete process.env.MT_CODEX_SESSIONS_DIR;
    else process.env.MT_CODEX_SESSIONS_DIR = savedCodexSessionsEnv;
    fs.rmSync(probeTmp, { recursive: true, force: true });
  });

  test('claude: returns row with provider, project, snippet, model', () => {
    const claudeDir = path.join(probeTmp, 'claude');
    writeClaudeSession(claudeDir, '-test-cwd-mm', 'sess.jsonl',
      'sess-claude-1', '/test-cwd/mm',
      { lastUserText: 'hello mm', model: 'claude-opus-4-6' });

    const rows = getActiveAgentsLive({
      claudeProjectsDir: claudeDir,
      codexSessionsDir: path.join(probeTmp, 'nope-codex'),
      geminiSessionsDir: path.join(probeTmp, 'nope-gemini'),
    });
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.provider).toBe('claude');
    expect(r.project).toBe('mm');
    expect(r.external_id).toBe('sess-claude-1');
    expect(r.last_user_snippet).toBeTruthy();
    expect(r.model).toBe('claude-opus-4-6');
    expect(r.cwd).toBe('/test-cwd/mm');
  });

  test('codex: confirmation test — one row from session_meta record', () => {
    const codexDir = path.join(probeTmp, 'codex');
    writeCodexSession(codexDir, '2026-04-22', 'rollout-1.jsonl',
      'sess-codex-1', '/test-cwd/mm',
      { lastUserText: 'hello codex' });

    const rows = getActiveAgentsLive({
      claudeProjectsDir: path.join(probeTmp, 'nope-claude'),
      codexSessionsDir: codexDir,
      geminiSessionsDir: path.join(probeTmp, 'nope-gemini'),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].provider).toBe('codex');
    expect(rows[0].external_id).toBe('sess-codex-1');
    expect(rows[0].project).toBe('mm');
  });

  test('codex: ordered env roots return only the first copy of a duplicate session', () => {
    const primaryDir = path.join(probeTmp, 'codex-primary');
    const fallbackDir = path.join(probeTmp, 'codex-fallback');
    writeCodexSession(primaryDir, '2026-04-22', 'rollout-primary.jsonl',
      'sess-codex-duplicate', '/test-cwd/mm',
      { lastUserText: 'primary winner', model: 'gpt-primary' });
    writeCodexSession(fallbackDir, '2026-04-22', 'rollout-fallback.jsonl',
      'sess-codex-duplicate', '/test-cwd/mm',
      { lastUserText: 'newer fallback loser', model: 'gpt-fallback' });
    const newer = (Date.now() + 1000) / 1000;
    const fallbackFile = path.join(fallbackDir, '2026-04-22', 'rollout-fallback.jsonl');
    fs.utimesSync(fallbackFile, newer, newer);
    process.env.MT_CODEX_SESSIONS_DIR = `${primaryDir}:${fallbackDir}`;

    const rows = getActiveAgentsLive({
      claudeProjectsDir: path.join(probeTmp, 'nope-claude'),
      geminiSessionsDir: path.join(probeTmp, 'nope-gemini'),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe('sess-codex-duplicate');
    expect(rows[0].model).toBe('gpt-primary');
  });

  test('codex: an inactive primary copy still shadows a resumed fallback copy', () => {
    const primaryDir = path.join(probeTmp, 'codex-primary');
    const fallbackDir = path.join(probeTmp, 'codex-fallback');
    writeCodexSession(primaryDir, '2026-04-22', 'rollout-primary.jsonl',
      'sess-codex-shadowed', '/test-cwd/mm', { model: 'gpt-primary' });
    writeCodexSession(fallbackDir, '2026-04-22', 'rollout-fallback.jsonl',
      'sess-codex-shadowed', '/test-cwd/mm', { model: 'gpt-fallback' });
    const stale = (Date.now() - 60 * 60 * 1000) / 1000;
    fs.utimesSync(path.join(primaryDir, '2026-04-22', 'rollout-primary.jsonl'), stale, stale);
    process.env.MT_CODEX_SESSIONS_DIR = `${primaryDir}:${fallbackDir}`;

    const rows = getActiveAgentsLive({
      maxAgeSeconds: 300,
      claudeProjectsDir: path.join(probeTmp, 'nope-claude'),
      geminiSessionsDir: path.join(probeTmp, 'nope-gemini'),
    });

    expect(rows).toHaveLength(0);
  });

  test('gemini: confirmation test — one row from JSON session file', () => {
    const geminiDir = path.join(probeTmp, 'gemini');
    writeGeminiSession(geminiDir, 'mm', 'session-g1.json',
      'sess-gemini-1', { lastUserText: 'hello gemini' });

    const rows = getActiveAgentsLive({
      claudeProjectsDir: path.join(probeTmp, 'nope-claude'),
      codexSessionsDir: path.join(probeTmp, 'nope-codex'),
      geminiSessionsDir: geminiDir,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].provider).toBe('gemini');
    expect(rows[0].external_id).toBe('sess-gemini-1');
    expect(rows[0].project).toBe('mm');
  });

  test('stale file: session older than maxAgeSeconds is excluded', () => {
    const claudeDir = path.join(probeTmp, 'claude');
    writeClaudeSession(claudeDir, 'old-proj', 'old.jsonl',
      'sess-stale', '/test-cwd/old-proj',
      { lastUserText: 'old turn' });
    const filePath = path.join(claudeDir, 'old-proj', 'old.jsonl');
    // Age the file 20 min into the past.
    const twentyMinAgo = (Date.now() - 20 * 60 * 1000) / 1000;
    fs.utimesSync(filePath, twentyMinAgo, twentyMinAgo);

    const rows = getActiveAgentsLive({
      maxAgeSeconds: 300,
      claudeProjectsDir: claudeDir,
      codexSessionsDir: path.join(probeTmp, 'nope'),
      geminiSessionsDir: path.join(probeTmp, 'nope'),
    });
    expect(rows.length).toBe(0);
  });

  test('project filter: only matching project returned', () => {
    const claudeDir = path.join(probeTmp, 'claude');
    writeClaudeSession(claudeDir, 'proj-mm', 'mm.jsonl',
      'sess-mm', '/test-cwd/mm', { lastUserText: 'mm' });
    writeClaudeSession(claudeDir, 'proj-ac', 'ac.jsonl',
      'sess-ac', '/test-cwd/ac', { lastUserText: 'ac' });

    const rows = getActiveAgentsLive({
      project: 'mm',
      claudeProjectsDir: claudeDir,
      codexSessionsDir: path.join(probeTmp, 'nope'),
      geminiSessionsDir: path.join(probeTmp, 'nope'),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].external_id).toBe('sess-mm');
  });

  test('min-turns filter: single-turn session without snippet excluded', () => {
    const claudeDir = path.join(probeTmp, 'claude');
    const projDir = path.join(claudeDir, 'proj');
    fs.mkdirSync(projDir, { recursive: true });
    // Session with one user record but NO text content → lastUserSnippet null, userTurns 0.
    fs.writeFileSync(path.join(projDir, 'one.jsonl'),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-noise',
        cwd: '/test-cwd/noise',
        timestamp: '2026-04-22T19:30:00Z',
        message: { content: [] },
      }) + '\n');

    const rows = getActiveAgentsLive({
      claudeProjectsDir: claudeDir,
      codexSessionsDir: path.join(probeTmp, 'nope'),
      geminiSessionsDir: path.join(probeTmp, 'nope'),
    });
    expect(rows.length).toBe(0);
  });

  test('participant resolution: populates participant_id when ac db has active row', () => {
    const claudeDir = path.join(probeTmp, 'claude');
    writeClaudeSession(claudeDir, 'proj-mm', 'mm.jsonl',
      'sess-linked', '/test-cwd/mm', { lastUserText: 'hi' });

    const acDbPath = path.join(probeTmp, 'ac-msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', 'sess-linked')`);
    acDb.close();
    process.env.MT_AC_DB_PATH = acDbPath;

    const rows = getActiveAgentsLive({
      claudeProjectsDir: claudeDir,
      codexSessionsDir: path.join(probeTmp, 'nope'),
      geminiSessionsDir: path.join(probeTmp, 'nope'),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].participant_id).toBe('mm_cto');
  });
});

// ---------- /active ROUTE ----------

async function spawnApi(env: Record<string, string | undefined>): Promise<{ port: number; kill: () => void }> {
  const port = 30000 + Math.floor(Math.random() * 5000);
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env, MT_PORT: String(port) };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  const proc = Bun.spawn(['bun', 'src/api.ts'], {
    cwd: path.resolve(import.meta.dir, '..'),
    env: childEnv as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/help`);
      if (r.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  return { port, kill: () => { try { proc.kill(); } catch {} } };
}

describe('/active route', () => {
  let apiTmp: string;
  beforeEach(() => {
    apiTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-api-active-'));
    savedEnv = process.env.MT_AC_DB_PATH;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MT_AC_DB_PATH;
    else process.env.MT_AC_DB_PATH = savedEnv;
    fs.rmSync(apiTmp, { recursive: true, force: true });
  });

  test('?format=json returns application/json with {agents, generated_at}', async () => {
    const api = await spawnApi({ MT_BRAIN_ROOT: apiTmp });
    try {
      const r = await fetch(`http://127.0.0.1:${api.port}/active?format=json`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('application/json');
      const body = await r.json() as any;
      expect(Array.isArray(body.agents)).toBe(true);
      expect(typeof body.generated_at).toBe('string');
      expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      api.kill();
    }
  });

  test('?format=json&probe=live returns JSON from live-probe path (empty dirs → agents=[])', async () => {
    const claudeDir = path.join(apiTmp, 'no-claude');
    const codexDir = path.join(apiTmp, 'no-codex');
    const geminiDir = path.join(apiTmp, 'no-gemini');
    const api = await spawnApi({
      MT_BRAIN_ROOT: apiTmp,
      MT_CLAUDE_PROJECTS_DIR: claudeDir,
      MT_CODEX_SESSIONS_DIR: codexDir,
      MT_GEMINI_SESSIONS_DIR: geminiDir,
    });
    try {
      const r = await fetch(`http://127.0.0.1:${api.port}/active?format=json&probe=live`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('application/json');
      const body = await r.json() as any;
      expect(Array.isArray(body.agents)).toBe(true);
      expect(body.agents.length).toBe(0);
      expect(typeof body.generated_at).toBe('string');
    } finally {
      api.kill();
    }
  });

  test('configured missing DB is visibly different from an unconfigured DB', async () => {
    const missingPath = path.join(apiTmp, 'missing-msg.db');
    const api = await spawnApi({ MT_BRAIN_ROOT: apiTmp, MT_AC_DB_PATH: missingPath });
    try {
      const response = await fetch(`http://127.0.0.1:${api.port}/active?format=json`);
      expect(response.headers.get('x-mm-ac-db-status')).toBe('missing');
      const body = await response.json() as any;
      expect(body.ac_db).toMatchObject({
        status: 'missing',
        source: 'mt_ac_db_path',
        path: missingPath,
      });
      expect(body.ac_db.message).toContain('does not exist');
    } finally {
      api.kill();
    }
  });

  test('wrong-schema DB is unreadable on /active and both R1 active surfaces', async () => {
    const wrongSchemaPath = path.join(apiTmp, 'wrong-schema.db');
    const wrongDb = new Database(wrongSchemaPath);
    wrongDb.exec('CREATE TABLE unrelated (id TEXT)');
    wrongDb.close();
    const api = await spawnApi({ MT_BRAIN_ROOT: apiTmp, MT_AC_DB_PATH: wrongSchemaPath });
    try {
      const json = await fetch(`http://127.0.0.1:${api.port}/active?format=json`);
      expect(json.headers.get('x-mm-ac-db-status')).toBe('unreadable');
      expect((await json.json() as any).ac_db).toMatchObject({
        status: 'unreadable',
        source: 'mt_ac_db_path',
        path: wrongSchemaPath,
      });

      const markdown = await fetch(`http://127.0.0.1:${api.port}/active`);
      expect(markdown.headers.get('x-mm-ac-db-status')).toBe('unreadable');
      expect(await markdown.text()).toContain('participant resolution is unavailable (unreadable)');

      for (const endpoint of ['/api/v1/sessions/active', '/api/v1/tokens/active']) {
        const active = await fetch(`http://127.0.0.1:${api.port}${endpoint}`);
        expect(active.headers.get('x-mm-ac-db-status')).toBe('unreadable');
        expect((await active.json() as any).ac_db).toMatchObject({
          status: 'unreadable',
          source: 'mt_ac_db_path',
          path: wrongSchemaPath,
        });
      }
    } finally {
      api.kill();
    }
  });

  test('no configured DB is loud and distinguishable on active surfaces', async () => {
    const api = await spawnApi({
      MT_BRAIN_ROOT: apiTmp,
      MT_AC_DB_PATH: undefined,
    });
    try {
      const json = await fetch(`http://127.0.0.1:${api.port}/active?format=json`);
      expect(json.status).toBe(200);
      expect(json.headers.get('x-mm-ac-db-status')).toBe('unresolved');
      const body = await json.json() as any;
      expect(body.agents).toEqual([]);
      expect(body.ac_db).toMatchObject({ status: 'unresolved', source: null, path: null });
      expect(body.ac_db.message).toContain('not configured');

      const markdown = await fetch(`http://127.0.0.1:${api.port}/active`);
      expect(markdown.headers.get('x-mm-ac-db-status')).toBe('unresolved');
      expect(await markdown.text()).toContain('**Warning:** participant resolution is unavailable (unresolved)');

      for (const endpoint of ['/api/v1/sessions/active', '/api/v1/tokens/active']) {
        const active = await fetch(`http://127.0.0.1:${api.port}${endpoint}`);
        expect(active.headers.get('x-mm-ac-db-status')).toBe('unresolved');
        expect((await active.json() as any).ac_db).toMatchObject({
          status: 'unresolved',
          source: null,
          path: null,
        });
      }
    } finally {
      api.kill();
    }
  });

  test('/active participant naming uses MT_AC_DB_PATH through the shared resolver', async () => {
    const configuredPath = path.join(apiTmp, 'install-msg.db');
    const acDb = makeAcShapeDb(configuredPath);
    acDb.exec(`INSERT INTO participants (id, project, role, active_session_id) VALUES ('mm_cto', 'mm', 'cto', 'sess-configured')`);
    acDb.close();

    const api = await spawnApi({
      MT_BRAIN_ROOT: apiTmp,
      MT_AC_DB_PATH: configuredPath,
    });
    try {
      const brainDb = new Database(path.join(apiTmp, 'meta', 'brain.db'));
      brainDb.prepare(`INSERT INTO import_state
        (source_path, last_mtime, last_imported_at, provider, external_id, project, cwd, model, last_user_snippet, min_turns_ok)
        VALUES (?, ?, CURRENT_TIMESTAMP, 'claude', 'sess-configured', 'mm', '/tmp/mm', 'claude-opus', 'hello', 1)`
      ).run('/tmp/sess-configured.jsonl', Date.now());
      brainDb.close();

      const response = await fetch(`http://127.0.0.1:${api.port}/active?format=json`);
      expect(response.headers.get('x-mm-ac-db-status')).toBe('available');
      const body = await response.json() as any;
      expect(body.ac_db).toMatchObject({
        status: 'available',
        source: 'mt_ac_db_path',
        path: configuredPath,
      });
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].participant_id).toBe('mm_cto');
    } finally {
      api.kill();
    }
  });
});

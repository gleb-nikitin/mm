import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveParticipantIds, resolveAcDbPath } from '../src/core';
import { getActiveAgentsLive } from '../src/session-probe';

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

  test('env value wins — returned even if target does not exist', () => {
    const envOverride = path.join(pathTmp, 'does-not-exist.db');
    const resolved = resolveAcDbPath({
      envValue: envOverride,
      prodPath: path.join(pathTmp, 'prod.db'),
      workspacePath: path.join(pathTmp, 'workspace.db'),
    });
    expect(resolved).toBe(envOverride);
  });

  test('prod preferred over workspace when both exist', () => {
    const prodPath = path.join(pathTmp, 'prod.db');
    const workspacePath = path.join(pathTmp, 'workspace.db');
    fs.writeFileSync(prodPath, '');
    fs.writeFileSync(workspacePath, '');
    const resolved = resolveAcDbPath({ prodPath, workspacePath });
    expect(resolved).toBe(prodPath);
  });

  test('workspace fallback when prod absent', () => {
    const prodPath = path.join(pathTmp, 'prod.db');
    const workspacePath = path.join(pathTmp, 'workspace.db');
    fs.writeFileSync(workspacePath, '');
    // prodPath intentionally not created
    const resolved = resolveAcDbPath({ prodPath, workspacePath });
    expect(resolved).toBe(workspacePath);
  });

  test('neither exists → workspace returned (caller existsSync handles final gap)', () => {
    const prodPath = path.join(pathTmp, 'prod.db');
    const workspacePath = path.join(pathTmp, 'workspace.db');
    const resolved = resolveAcDbPath({ prodPath, workspacePath });
    expect(resolved).toBe(workspacePath);
  });

  test('integration: resolveParticipantIds reads through prod when prod DB is seeded', () => {
    const prodPath = path.join(pathTmp, 'prod.db');
    const workspacePath = path.join(pathTmp, 'workspace.db');
    // Prod has the live data
    const prodDb = makeAcShapeDb(prodPath);
    prodDb.exec(`INSERT INTO participants (id, project, role) VALUES ('mm_cto', 'mm', 'cto')`);
    prodDb.exec(`INSERT INTO llm_sessions (id, participant_id, is_active) VALUES ('sess-prod', 'mm_cto', 1)`);
    prodDb.close();
    // Workspace is empty (realistic: workspace DB exists but has no active sessions)
    const wsDb = makeAcShapeDb(workspacePath);
    wsDb.close();

    // Point env at prod via the env-var surface (integration contract)
    process.env.MT_AC_DB_PATH = prodPath;
    const out = resolveParticipantIds(['sess-prod']);
    expect(out.get('sess-prod')).toBe('mm_cto');
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
  beforeEach(() => {
    probeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-live-probe-'));
    savedEnv = process.env.MT_AC_DB_PATH;
    // Isolate from real ac db lookups
    process.env.MT_AC_DB_PATH = path.join(probeTmp, 'no-ac.db');
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.MT_AC_DB_PATH;
    else process.env.MT_AC_DB_PATH = savedEnv;
    fs.rmSync(probeTmp, { recursive: true, force: true });
  });

  test('claude: returns row with provider, project, snippet, model', () => {
    const claudeDir = path.join(probeTmp, 'claude');
    writeClaudeSession(claudeDir, '-Users-glebnikitin-work-code-mm', 'sess.jsonl',
      'sess-claude-1', '/Users/glebnikitin/work/code/mm',
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
    expect(r.cwd).toBe('/Users/glebnikitin/work/code/mm');
  });

  test('codex: confirmation test — one row from session_meta record', () => {
    const codexDir = path.join(probeTmp, 'codex');
    writeCodexSession(codexDir, '2026-04-22', 'rollout-1.jsonl',
      'sess-codex-1', '/Users/glebnikitin/work/code/mm',
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
      'sess-stale', '/Users/glebnikitin/work/code/old-proj',
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
      'sess-mm', '/Users/glebnikitin/work/code/mm', { lastUserText: 'mm' });
    writeClaudeSession(claudeDir, 'proj-ac', 'ac.jsonl',
      'sess-ac', '/Users/glebnikitin/work/code/ac', { lastUserText: 'ac' });

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
        cwd: '/Users/glebnikitin/work/code/noise',
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
      'sess-linked', '/Users/glebnikitin/work/code/mm', { lastUserText: 'hi' });

    const acDbPath = path.join(probeTmp, 'ac-msg.db');
    const acDb = makeAcShapeDb(acDbPath);
    acDb.exec(`INSERT INTO participants (id, project, role) VALUES ('mm_cto', 'mm', 'cto')`);
    acDb.exec(`INSERT INTO llm_sessions (id, participant_id, is_active) VALUES ('sess-linked', 'mm_cto', 1)`);
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

async function spawnApi(env: Record<string, string>): Promise<{ port: number; kill: () => void }> {
  const port = 30000 + Math.floor(Math.random() * 5000);
  const proc = Bun.spawn(['bun', 'src/api.ts'], {
    cwd: path.resolve(import.meta.dir, '..'),
    env: { ...process.env, ...env, MT_PORT: String(port) },
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
});

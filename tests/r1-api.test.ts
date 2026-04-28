import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(import.meta.dir, '..');

let tmpRoot: string;

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

function seedSessions(): void {
  const proc = Bun.spawnSync({
    cmd: ['bun', '-e', `
      const { initDb, db } = await import('./src/core.ts');
      initDb();
      const insert = db.prepare(\`
        INSERT INTO session_index
          (vendor, session_id, source_path, participant_id, project, role,
           project_role, cwd, model, started_at, last_activity_at, last_mtime,
           last_log_line, state, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
      \`);
      const rows = [
        ['claude', 'sess-mm-cto-working', '/tmp/a', 'mm_cto', 'mm', 'cto', 'mm/cto', '/repo/mm', 'claude-opus', '2026-04-22T10:00:00Z', '2026-04-22T10:05:00Z', 5, 'working log', 'working'],
        ['codex', 'sess-mm-devops-idle', '/tmp/b', 'mm_devops', 'mm', 'devops', 'mm/devops', '/repo/mm', 'gpt-5', '2026-04-22T10:00:00Z', '2026-04-22T10:04:00Z', 4, 'idle log', 'idle'],
        ['gemini', 'sess-ac-cto-wedged', '/tmp/c', 'ac_cto', 'ac', 'cto', 'ac/cto', '/repo/ac', 'gemini-2.5', '2026-04-22T10:00:00Z', '2026-04-22T10:03:00Z', 3, 'wedged log', 'wedged'],
        ['claude', 'sess-ac-qa-completed', '/tmp/d', 'ac_qa', 'ac', 'qa', 'ac/qa', '/repo/ac', 'claude-opus', '2026-04-22T10:00:00Z', '2026-04-22T10:02:00Z', 2, 'completed log', 'completed'],
        ['codex', 'sess-infra-devops-orphan', '/tmp/e', null, 'infra', 'devops', null, '/repo/infra', 'gpt-5', '2026-04-22T10:00:00Z', '2026-04-22T10:01:00Z', 1, 'orphan log', 'orphan'],
      ];
      for (const row of rows) insert.run(...row);
      db.close();
    `],
    cwd: REPO,
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (proc.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(proc.stderr));
  }
}

async function spawnApi(): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await getFreePort();
  const proc = Bun.spawn(['bun', 'src/api.ts'], {
    cwd: REPO,
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, MT_PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const deadline = Date.now() + 5000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/help`);
      if (r.ok) { ready = true; break; }
    } catch {}
    if (proc.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!ready) {
    proc.kill();
    const stderr = await new Response(proc.stderr).text();
    throw new Error(stderr || `API did not start on ${port}`);
  }
  return {
    port,
    close: async () => {
      proc.kill();
      await proc.exited;
    },
  };
}

async function withApi<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const api = await spawnApi();
  try {
    return await fn(`http://127.0.0.1:${api.port}`);
  } finally {
    await api.close();
  }
}

async function getJson(base: string, pathAndQuery: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${pathAndQuery}`);
  return { status: response.status, body: await response.json() };
}

function sessionIds(body: any): string[] {
  return body.sessions.map((session: any) => session.session_id);
}

describe('R1 active sessions API', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-api-'));
    fs.mkdirSync(path.join(tmpRoot, 'raw'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'wiki'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'meta'), { recursive: true });
    seedSessions();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('default filters return active-state JSON envelope with ISO timestamp', async () => {
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/sessions/active');
      expect(status).toBe(200);
      expect(sessionIds(body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
      expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.sessions[0]).toEqual({
        project_role: 'mm/cto',
        participant_id: 'mm_cto',
        session_id: 'sess-mm-cto-working',
        vendor: 'claude',
        model: 'claude-opus',
        started_at: '2026-04-22T10:00:00Z',
        last_activity_at: '2026-04-22T10:05:00Z',
        last_log_line: 'working log',
        state: 'working',
      });
    });
  });

  test('project filters support single, comma-separated, and all', async () => {
    await withApi(async base => {
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?project=mm')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?project=mm,ac')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?project=all')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
    });
  });

  test('role filters support single, comma-separated, and all', async () => {
    await withApi(async base => {
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?role=cto')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?role=cto,devops')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?role=all')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
    });
  });

  test('state filters support single state and exhaustive CSV', async () => {
    await withApi(async base => {
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?state=working')).body)).toEqual([
        'sess-mm-cto-working',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?state=working,idle,wedged,completed,orphan')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
        'sess-ac-qa-completed',
        'sess-infra-devops-orphan',
      ]);
    });
  });

  test('limit accepts normal and max values', async () => {
    await withApi(async base => {
      const ten = await getJson(base, '/api/v1/sessions/active?limit=10');
      expect(ten.status).toBe(200);
      expect(ten.body.sessions.length).toBe(3);
      const max = await getJson(base, '/api/v1/sessions/active?limit=200');
      expect(max.status).toBe(200);
      expect(max.body.sessions.length).toBe(3);
    });
  });

  test('validation errors use v1 error envelope', async () => {
    await withApi(async base => {
      const overLimit = await getJson(base, '/api/v1/sessions/active?limit=201');
      expect(overLimit.status).toBe(400);
      expect(overLimit.body.error.code).toBe('validation');
      expect(overLimit.body.error.details.max).toBe(200);

      const badLimit = await getJson(base, '/api/v1/sessions/active?limit=abc');
      expect(badLimit.status).toBe(400);
      expect(badLimit.body.error.code).toBe('validation');

      const badState = await getJson(base, '/api/v1/sessions/active?state=working,unknown');
      expect(badState.status).toBe(400);
      expect(badState.body.error.code).toBe('validation');
      expect(badState.body.error.details.invalid).toEqual(['unknown']);
    });
  });

  test('unknown v1 route uses JSON not_found envelope', async () => {
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/nope');
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
    });
  });

  test('legacy /active surfaces keep their old shapes', async () => {
    await withApi(async base => {
      const markdown = await fetch(`${base}/active`);
      expect(markdown.status).toBe(200);
      expect(markdown.headers.get('content-type')).toContain('text/markdown');
      expect(await markdown.text()).toContain('# Active agents');

      const legacyJson = await getJson(base, '/active?format=json');
      expect(legacyJson.status).toBe(200);
      expect(Array.isArray(legacyJson.body.agents)).toBe(true);
      expect(typeof legacyJson.body.generated_at).toBe('string');
      expect(legacyJson.body.sessions).toBeUndefined();
    });
  });
});

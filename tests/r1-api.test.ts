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

function costBreakdown(model: string) {
  return JSON.stringify({
    model,
    source: 'pricing.toml',
    lines: [
      { type: 'input', tokens: 1000, rate: 5, cost: 0.005 },
      { type: 'output', tokens: 200, rate: 25, cost: 0.005 },
      { type: 'cached', tokens: 100, rate: 0.5, cost: 0.00005 },
      { type: 'reasoning', tokens: 50, rate: 25, cost: 0.00125 },
    ],
  });
}

function seedCostFixtures(): void {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const db = new Database(dbPath);
  try {
    const insertSession = db.prepare(`
      INSERT INTO session_index
        (vendor, session_id, source_path, participant_id, project, role,
         project_role, cwd, model, started_at, last_activity_at, last_mtime,
         last_log_line, state, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
    `);
    insertSession.run(
      'claude', 'shared-cost-session', '/tmp/shared-a', 'mm_cto', 'mm', 'cto',
      'mm/cto', '/repo/mm', 'claude-opus-4-6', '2026-04-22T11:00:00Z',
      '2026-04-22T11:01:00Z', 1, 'shared a', 'completed',
    );
    insertSession.run(
      'codex', 'shared-cost-session', '/tmp/shared-b', 'mm_devops', 'mm', 'devops',
      'mm/devops', '/repo/mm', 'gpt-5.4', '2026-04-22T11:00:00Z',
      '2026-04-22T11:01:00Z', 1, 'shared b', 'completed',
    );

    const insertUsage = db.prepare(`
      INSERT INTO session_usage
        (vendor, session_id, participant_id, model, input_tokens, output_tokens,
         cached_tokens, reasoning_tokens, cost_usd, cost_breakdown, pricing_source, priced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertUsage.run(
      'claude', 'sess-mm-cto-working', 'mm_cto', 'claude-opus-4-6',
      1000, 200, 100, 50, 0.0113, costBreakdown('claude-opus-4-6'),
      'pricing.toml', '2026-04-22T12:00:00Z',
    );
    insertUsage.run(
      'claude', 'shared-cost-session', 'mm_cto', 'claude-opus-4-6',
      1000, 200, 100, 50, 0.0113, costBreakdown('claude-opus-4-6'),
      'pricing.toml', '2026-04-22T12:00:00Z',
    );
    insertUsage.run(
      'codex', 'shared-cost-session', 'mm_devops', 'gpt-5.4',
      500, 60, 30, 20, 0.002, costBreakdown('gpt-5.4'),
      'pricing.toml', '2026-04-22T12:00:00Z',
    );

    db.prepare(`
      INSERT INTO session_message_links
        (chain_msg_id, chain, seq, from_id, to_id, vendor, session_id,
         participant_id, source_path, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'xco-1', 'xco', 1, 'mm_cto', 'mm_devops', 'claude',
      'sess-mm-cto-working', 'mm_cto', '/tmp/a', 'exact',
    );
  } finally {
    db.close();
  }
}

function insertSessionEvent(event: {
  event_type: string;
  vendor: string;
  session_id: string;
  participant_id: string | null;
  project_role: string | null;
  timestamp: string;
  last_log_line: string | null;
  payload: Record<string, unknown>;
}): number {
  const db = new Database(path.join(tmpRoot, 'meta', 'brain.db'));
  try {
    const result = db.prepare(`
      INSERT INTO session_events
        (event_type, vendor, session_id, participant_id, project_role, timestamp, last_log_line, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.event_type,
      event.vendor,
      event.session_id,
      event.participant_id,
      event.project_role,
      event.timestamp,
      event.last_log_line,
      JSON.stringify(event.payload),
    );
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function seedEventFixtures(): { first: number; second: number; latest: number } {
  const first = insertSessionEvent({
    event_type: 'session_started',
    vendor: 'claude',
    session_id: 'sess-mm-cto-working',
    participant_id: 'mm_cto',
    project_role: 'mm/cto',
    timestamp: '2026-04-22T10:05:00Z',
    last_log_line: 'working log',
    payload: { state: 'working' },
  });
  const second = insertSessionEvent({
    event_type: 'session_wedged',
    vendor: 'gemini',
    session_id: 'sess-ac-cto-wedged',
    participant_id: 'ac_cto',
    project_role: 'ac/cto',
    timestamp: '2026-04-22T10:03:00Z',
    last_log_line: 'wedged log',
    payload: { state: 'wedged' },
  });
  return { first, second, latest: second };
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

async function readSse(response: Response, count: number, timeoutMs = 3500): Promise<any[]> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const events: any[] = [];
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline && events.length < count) {
      const remaining = Math.max(1, deadline - Date.now());
      const read = await Promise.race([
        reader.read(),
        new Promise<any>(resolve => setTimeout(() => resolve({ done: false, value: new Uint8Array() }), remaining)),
      ]);
      if (read.done) break;
      if (read.value.length === 0) continue;
      text += decoder.decode(read.value, { stream: true });
      while (text.includes('\n\n') && events.length < count) {
        const idx = text.indexOf('\n\n');
        const raw = text.slice(0, idx);
        text = text.slice(idx + 2);
        const dataLine = raw.split('\n').find(line => line.startsWith('data: '));
        if (dataLine) events[events.length] = JSON.parse(dataLine.slice('data: '.length));
      }
    }
    return events;
  } finally {
    await reader.cancel().catch(() => {});
  }
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

  test('cost by session returns usage, validation, unknown, and ambiguous envelopes', async () => {
    seedCostFixtures();
    await withApi(async base => {
      const ok = await getJson(base, '/api/v1/cost/by-session?session_id=sess-mm-cto-working');
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        session_id: 'sess-mm-cto-working',
        participant: 'mm_cto',
        vendor: 'claude',
        tokens: { input: 1000, output: 200, cached: 100, reasoning: 50 },
        cost_usd: 0.0113,
      });
      expect(ok.body.cost_breakdown.lines).toHaveLength(4);

      const missingParam = await getJson(base, '/api/v1/cost/by-session');
      expect(missingParam.status).toBe(400);
      expect(missingParam.body.error.code).toBe('validation');

      const unknown = await getJson(base, '/api/v1/cost/by-session?session_id=missing');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('not_found');

      const ambiguous = await getJson(base, '/api/v1/cost/by-session?session_id=shared-cost-session');
      expect(ambiguous.status).toBe(409);
      expect(ambiguous.body.error.code).toBe('ambiguous');
      expect(ambiguous.body.error.details.vendors).toEqual(['claude', 'codex']);

      const disambiguated = await getJson(base, '/api/v1/cost/by-session?session_id=shared-cost-session&vendor=codex');
      expect(disambiguated.status).toBe(200);
      expect(disambiguated.body.vendor).toBe('codex');
    });
  });

  test('cost by message returns linked usage and 404 without link or usage', async () => {
    seedCostFixtures();
    await withApi(async base => {
      const ok = await getJson(base, '/api/v1/cost/by-message?chain_msg_id=xco-1');
      expect(ok.status).toBe(200);
      expect(ok.body.chain_msg_id).toBe('xco-1');
      expect(ok.body.link_confidence).toBe('exact');
      expect(ok.body.session_id).toBe('sess-mm-cto-working');
      expect(ok.body.tokens.input).toBe(1000);

      const missing = await getJson(base, '/api/v1/cost/by-message?chain_msg_id=xco-missing');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('not_found');

      const missingParam = await getJson(base, '/api/v1/cost/by-message');
      expect(missingParam.status).toBe(400);
      expect(missingParam.body.error.code).toBe('validation');
    });
  });

  test('session events replay from since_id and support project/role filters', async () => {
    const ids = seedEventFixtures();
    await withApi(async base => {
      const replay = await fetch(`${base}/api/v1/sessions/events?since_id=${ids.first - 1}`);
      const replayEvents = await readSse(replay, 2);
      expect(replayEvents.map(event => event.event_type)).toEqual(['session_started', 'session_wedged']);

      const projectFiltered = await fetch(`${base}/api/v1/sessions/events?since_id=0&project=mm`);
      const projectEvents = await readSse(projectFiltered, 1);
      expect(projectEvents.map(event => event.project_role)).toEqual(['mm/cto']);

      const roleFiltered = await fetch(`${base}/api/v1/sessions/events?since_id=0&role=cto`);
      const roleEvents = await readSse(roleFiltered, 2);
      expect(roleEvents.map(event => event.project_role)).toEqual(['mm/cto', 'ac/cto']);
    });
  });

  test('session events reject invalid since_id before stream headers', async () => {
    await withApi(async base => {
      const bad = await getJson(base, '/api/v1/sessions/events?since_id=abc');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('validation');
    });
  });

  test('session events live stream receives rows appended after connect', async () => {
    const ids = seedEventFixtures();
    await withApi(async base => {
      const response = await fetch(`${base}/api/v1/sessions/events?since_id=${ids.latest}`);
      const read = readSse(response, 1, 5000);
      await new Promise(resolve => setTimeout(resolve, 100));
      insertSessionEvent({
        event_type: 'session_idle',
        vendor: 'codex',
        session_id: 'sess-mm-devops-idle',
        participant_id: 'mm_devops',
        project_role: 'mm/devops',
        timestamp: '2026-04-22T10:04:00Z',
        last_log_line: 'idle log',
        payload: { state: 'idle' },
      });
      const events = await read;
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('session_idle');
      expect(events[0].project_role).toBe('mm/devops');
    });
  }, 8000);
});

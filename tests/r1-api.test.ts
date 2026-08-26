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

function unpricedCostBreakdown(model: string) {
  return JSON.stringify({
    model,
    source: 'unknown',
    lines: [
      { type: 'input', tokens: 100, rate: null, cost: null },
      { type: 'output', tokens: 50, rate: null, cost: null },
      { type: 'cached', tokens: 10, rate: null, cost: null },
      { type: 'reasoning', tokens: 5, rate: null, cost: null },
    ],
  });
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function seedCostFixtures(): void {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const claudeContextPath = path.join(tmpRoot, 'claude-context.jsonl');
  fs.writeFileSync(claudeContextPath, JSON.stringify({
    sessionId: 'sess-mm-cto-working',
    type: 'assistant',
    timestamp: '2026-04-22T10:05:00Z',
    message: {
      usage: {
        input_tokens: 50000,
        cache_creation_input_tokens: 100000,
        cache_read_input_tokens: 80550,
      },
    },
  }) + '\n');
  const db = new Database(dbPath);
  try {
    db.prepare(`
      UPDATE session_index
      SET source_path = ?
      WHERE vendor = 'claude' AND session_id = 'sess-mm-cto-working'
    `).run(claudeContextPath);

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

function seedSessionContentFixture(): void {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const db = new Database(dbPath);
  try {
    const metadata = JSON.stringify({
      provider: 'claude',
      session_id: 'sess-mm-cto-working',
      turn_count: 2,
    });
    const result = db.prepare(`
      INSERT INTO raw_events (source_type, project, external_id, timestamp, title, content, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'llm_chat',
      'mm',
      'claude:sess-mm-cto-working',
      '2026-04-22T10:00:00Z',
      'Claude Session - mm - sess-mm',
      'User: read the current state\n\nAssistant: state reviewed\n\n[tool: sqlite]',
      metadata,
    );
    db.prepare(`
      UPDATE session_index
      SET raw_event_id = ?
      WHERE vendor = 'claude' AND session_id = 'sess-mm-cto-working'
    `).run(Number(result.lastInsertRowid));
    db.prepare(`
      INSERT INTO session_usage
        (vendor, session_id, participant_id, model, input_tokens, output_tokens,
         cached_tokens, reasoning_tokens, cost_usd, cost_breakdown, pricing_source, priced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'claude', 'sess-mm-cto-working', 'mm_cto', 'claude-opus-4-6',
      1000, 200, 100, 50, 0.0113, costBreakdown('claude-opus-4-6'),
      'pricing.toml', '2026-04-22T12:00:00Z',
    );
  } finally {
    db.close();
  }
}

function seedParticipantUsageFixtures(): { since24h: string; until30m: string } {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const db = new Database(dbPath);
  const recentClaude = isoHoursAgo(1);
  const recentCodex = isoHoursAgo(2);
  const oldGemini = isoHoursAgo(48);
  const unpricedOnly = isoHoursAgo(3);
  const since24h = isoHoursAgo(24);
  const until30m = isoHoursAgo(0.5);
  try {
    const insertSession = db.prepare(`
      INSERT INTO session_index
        (vendor, session_id, source_path, participant_id, project, role,
         project_role, cwd, model, started_at, last_activity_at, last_mtime,
         last_log_line, state, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
    `);
    const sessions = [
      ['claude', 'tokens-ac-cto-claude', '/tmp/tokens-a', 'ac_cto', 'ac', 'cto', 'ac/cto', '/repo/ac', 'claude-opus-4-6', recentClaude, recentClaude, 1, 'claude tokens', 'completed'],
      ['codex', 'tokens-ac-cto-codex', '/tmp/tokens-b', 'ac_cto', 'ac', 'cto', 'ac/cto', '/repo/ac', 'gpt-5.4', recentCodex, recentCodex, 1, 'codex tokens', 'completed'],
      ['gemini', 'tokens-ac-cto-gemini-old', '/tmp/tokens-c', 'ac_cto', 'ac', 'cto', 'ac/cto', '/repo/ac', 'gemini-unknown', oldGemini, oldGemini, 1, 'gemini tokens', 'completed'],
      ['gemini', 'tokens-unpriced-gemini', '/tmp/tokens-d', 'ac_unpriced', 'ac', 'ops', 'ac/ops', '/repo/ac', 'gemini-unknown', unpricedOnly, unpricedOnly, 1, 'unpriced tokens', 'completed'],
    ];
    for (const row of sessions) insertSession.run(...row);

    const insertUsage = db.prepare(`
      INSERT INTO session_usage
        (vendor, session_id, participant_id, model, input_tokens, output_tokens,
         cached_tokens, reasoning_tokens, cost_usd, cost_breakdown, pricing_source, priced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertUsage.run(
      'claude', 'tokens-ac-cto-claude', 'ac_cto', 'claude-opus-4-6',
      1000, 100, 10, 5, 0.015, costBreakdown('claude-opus-4-6'),
      'pricing.toml', recentClaude,
    );
    insertUsage.run(
      'codex', 'tokens-ac-cto-codex', 'ac_cto', 'gpt-5.4',
      500, 50, 5, 2, 0.004, costBreakdown('gpt-5.4'),
      'pricing.toml', recentCodex,
    );
    insertUsage.run(
      'gemini', 'tokens-ac-cto-gemini-old', 'ac_cto', 'gemini-unknown',
      200, 25, 2, 1, null, unpricedCostBreakdown('gemini-unknown'),
      'unknown', oldGemini,
    );
    insertUsage.run(
      'gemini', 'tokens-unpriced-gemini', 'ac_unpriced', 'gemini-unknown',
      100, 50, 10, 5, null, unpricedCostBreakdown('gemini-unknown'),
      'unknown', unpricedOnly,
    );
    return { since24h, until30m };
  } finally {
    db.close();
  }
}

function seedBoundaryUsageFixture(): void {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const db = new Database(dbPath);
  try {
    db.prepare(`
      INSERT INTO session_index
        (vendor, session_id, source_path, participant_id, project, role,
         project_role, cwd, model, started_at, last_activity_at, last_mtime,
         last_log_line, state, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
    `).run(
      'claude', 'tokens-boundary-claude', '/tmp/tokens-boundary', 'ac_boundary',
      'ac', 'cto', 'ac/cto', '/repo/ac', 'claude-opus-4-6',
      '2026-04-22T10:00:00Z', '2026-04-22T10:00:00Z', 1,
      'boundary tokens', 'completed',
    );
    db.prepare(`
      INSERT INTO session_usage
        (vendor, session_id, participant_id, model, input_tokens, output_tokens,
         cached_tokens, reasoning_tokens, cost_usd, cost_breakdown, pricing_source, priced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'claude', 'tokens-boundary-claude', 'ac_boundary', 'claude-opus-4-6',
      42, 7, 3, 1, 0.001, costBreakdown('claude-opus-4-6'),
      'pricing.toml', '2026-04-22T10:01:00Z',
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

async function spawnSocketApi(): Promise<{
  socketPath: string;
  port: number;
  close: () => Promise<{ stdout: string; stderr: string }>;
}> {
  const port = await getFreePort();
  const socketPath = path.join(tmpRoot, 'missing-parent', 'sockets', 'mm-test.sock');
  const proc = Bun.spawn(['bun', 'src/api.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      MT_BRAIN_ROOT: tmpRoot,
      MT_PORT: String(port),
      AURORA_PLUGIN_SOCKET: socketPath,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const deadline = Date.now() + 5000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://localhost/help', { unix: socketPath });
      if (r.ok) { ready = true; break; }
    } catch {}
    if (proc.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!ready) {
    proc.kill();
    const stderr = await new Response(proc.stderr).text();
    throw new Error(stderr || `API did not start on unix socket ${socketPath}`);
  }
  return {
    socketPath,
    port,
    close: async () => {
      proc.kill();
      await proc.exited;
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      fs.rmSync(socketPath, { force: true });
      return { stdout, stderr };
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

  test('default filters return compact active-state JSON envelope with relative age', async () => {
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/sessions/active');
      expect(status).toBe(200);
      expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const generatedAt = Date.parse(body.generated_at);
      expect(body.sessions[0]).toEqual({
        project_role: 'mm/cto',
        seconds_ago: Math.floor((generatedAt - Date.parse('2026-04-22T10:05:00Z')) / 1000),
        last_log_line: 'working log',
        state: 'working',
      });
      expect(Object.keys(body.sessions[0])).toEqual(['project_role', 'seconds_ago', 'last_log_line', 'state']);
    });
  });

  test('fields=compact keeps compact shape and fields=full preserves current shape', async () => {
    await withApi(async base => {
      const compact = await getJson(base, '/api/v1/sessions/active?fields=compact');
      expect(compact.status).toBe(200);
      expect(Object.keys(compact.body.sessions[0])).toEqual(['project_role', 'seconds_ago', 'last_log_line', 'state']);

      const { status, body } = await getJson(base, '/api/v1/sessions/active?fields=full');
      expect(status).toBe(200);
      expect(sessionIds(body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
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
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&project=mm')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&project=mm,ac')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&project=all')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
    });
  });

  test('role filters support single, comma-separated, and all', async () => {
    await withApi(async base => {
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&role=cto')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&role=cto,devops')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&role=all')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
      ]);
    });
  });

  test('state filters support single state and exhaustive CSV', async () => {
    await withApi(async base => {
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&state=wedged')).body)).toEqual([
        'sess-ac-cto-wedged',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&state=working')).body)).toEqual([
        'sess-mm-cto-working',
      ]);
      expect(sessionIds((await getJson(base, '/api/v1/sessions/active?fields=full&state=working,idle,wedged,completed,orphan')).body)).toEqual([
        'sess-mm-cto-working',
        'sess-mm-devops-idle',
        'sess-ac-cto-wedged',
        'sess-ac-qa-completed',
        'sess-infra-devops-orphan',
      ]);
    });
  });

  test('retired sessions are completed at ingestion and excluded from active tokens by default', async () => {
    const proc = Bun.spawnSync({
      cmd: ['bun', '-e', `
        const { initDb, db } = await import('./src/core.ts');
        const { upsertSessionObservation } = await import('./src/r1/session-index.ts');
        initDb();
        upsertSessionObservation({
          vendor: 'claude',
          session_id: 'sess-mm-cto-retired',
          source_path: '/tmp/retired',
          raw_event_id: null,
          project: 'mm',
          cwd: '/repo/mm',
          model: 'claude-opus',
          started_at: '2026-04-21T10:00:00Z',
          last_activity_at: '2026-04-21T10:05:00Z',
          last_mtime: 1,
          last_log_line: 'retired log',
          metadata: '{}',
        }, {
          kind: 'retired',
          participant_id: 'mm_cto',
          project: 'mm',
          role: 'cto',
          project_role: 'mm/cto',
        });
        console.log(db.prepare("SELECT state FROM session_index WHERE session_id = 'sess-mm-cto-retired'").get().state);
        db.close();
      `],
      cwd: REPO,
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    expect(new TextDecoder().decode(proc.stdout).trim()).toBe('completed');

    await withApi(async base => {
      const result = await getJson(base, '/api/v1/tokens/active?project=mm&role=cto&vendor=claude');
      expect(result.status).toBe(200);
      expect(result.body.participants.map((row: any) => row.session_id)).toEqual(['sess-mm-cto-working']);
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

      const badFields = await getJson(base, '/api/v1/sessions/active?fields=minimal');
      expect(badFields.status).toBe(400);
      expect(badFields.body.error.code).toBe('validation');
      expect(badFields.body.error.details.allowed).toEqual(['compact', 'full']);
    });
  });

  test('unknown v1 route uses JSON not_found envelope', async () => {
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/nope');
      expect(status).toBe(404);
      expect(body.error.code).toBe('not_found');
    });
  });

  test('AURORA_PLUGIN_SOCKET binds a unix socket instead of the TCP port', async () => {
    const api = await spawnSocketApi();
    let output: { stdout: string; stderr: string } | null = null;
    try {
      const socketStats = await fetch('http://localhost/stats', { unix: api.socketPath });
      expect(socketStats.status).toBe(200);

      const sessionsPage = await fetch('http://localhost/sessions', { unix: api.socketPath });
      expect(sessionsPage.status).toBe(200);
      const sessionsHtml = await sessionsPage.text();
      expect(sessionsHtml).toContain('window.MM_BASE = "/plugin/mm";');
      expect(sessionsHtml).toContain('href="/plugin/mm/sessions"');

      const activeUiPage = await fetch('http://localhost/active-ui', { unix: api.socketPath });
      expect(activeUiPage.status).toBe(200);
      expect(await activeUiPage.text()).toContain('src="/plugin/mm/ui/alpine/cdn.min.js"');

      const monitorPage = await fetch('http://localhost/monitor', { unix: api.socketPath });
      expect(monitorPage.status).toBe(200);
      expect(await monitorPage.text()).toContain('href="/plugin/mm/monitor/tokens/active"');

      let portReachable = true;
      try {
        await fetch(`http://127.0.0.1:${api.port}/stats`);
      } catch {
        portReachable = false;
      }
      expect(portReachable).toBe(false);
      expect(fs.existsSync(path.dirname(api.socketPath))).toBe(true);
    } finally {
      output = await api.close();
    }
    expect(output.stdout).toContain(`unix:${api.socketPath}`);
    expect(output.stdout).not.toContain(`http://127.0.0.1:${api.port}`);
  });

  test('sessions browser API lists sessions with usage, filters, sorts, and paginates', async () => {
    seedCostFixtures();
    await withApi(async base => {
      const first = await getJson(base, '/api/v1/sessions?limit=2');
      expect(first.status).toBe(200);
      expect(first.body.total).toBe(7);
      expect(first.body.offset).toBe(0);
      expect(first.body.limit).toBe(2);
      expect(first.body.sessions[0]).toMatchObject({
        vendor: 'claude',
        session_id: 'shared-cost-session',
        participant_id: 'mm_cto',
        project_role: 'mm/cto',
        model: 'claude-opus-4-6',
        state: 'completed',
        tokens: null,
        cost_usd: 0.0113,
      });

      const second = await getJson(base, '/api/v1/sessions?limit=2&offset=2');
      expect(second.status).toBe(200);
      expect(second.body.sessions).toHaveLength(2);

      const orphan = await getJson(base, '/api/v1/sessions?state=orphan');
      expect(orphan.status).toBe(200);
      expect(orphan.body.sessions.map((session: any) => session.session_id)).toEqual(['sess-infra-devops-orphan']);

      const tokens = await getJson(base, '/api/v1/sessions?sort=tokens:desc&limit=1');
      expect(tokens.status).toBe(200);
      expect(tokens.body.sessions[0]).toMatchObject({
        session_id: 'sess-mm-cto-working',
        tokens: 230550,
        cost_usd: 0.0113,
      });

      const activeTokens = await getJson(base, '/api/v1/tokens/active?project=mm&role=cto&vendor=claude');
      expect(activeTokens.status).toBe(200);
      expect(activeTokens.body.participants[0]).toMatchObject({
        session_id: 'sess-mm-cto-working',
        tokens: tokens.body.sessions[0].tokens,
      });

      const filtered = await getJson(base, '/api/v1/sessions?participant_id=mm_devops&project=mm&vendor=codex');
      expect(filtered.status).toBe(200);
      expect(filtered.body.sessions.map((session: any) => session.session_id)).toEqual([
        'shared-cost-session',
        'sess-mm-devops-idle',
      ]);
    });
  });

  test('sessions browser API validates params', async () => {
    await withApi(async base => {
      const badVendor = await getJson(base, '/api/v1/sessions?vendor=unknown');
      expect(badVendor.status).toBe(400);
      expect(badVendor.body.error.code).toBe('validation');

      const badState = await getJson(base, '/api/v1/sessions?state=working,idle');
      expect(badState.status).toBe(400);
      expect(badState.body.error.details.allowed).toEqual(['working', 'idle', 'wedged', 'completed', 'orphan']);

      const badSort = await getJson(base, '/api/v1/sessions?sort=session_id:asc');
      expect(badSort.status).toBe(400);
      expect(badSort.body.error.details.allowed).toContain('last_activity_at:desc');
    });
  });

  test('session content API returns paginated turns and metadata', async () => {
    seedSessionContentFixture();
    await withApi(async base => {
      const first = await getJson(base, '/api/v1/sessions/claude/sess-mm-cto-working/content?limit=1');
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        vendor: 'claude',
        session_id: 'sess-mm-cto-working',
        participant_id: 'mm_cto',
        project_role: 'mm/cto',
        model: 'claude-opus',
        tokens: 1350,
        cost_usd: 0.0113,
        turn_count: 2,
        offset: 0,
        limit: 1,
      });
      expect(first.body.turns).toHaveLength(1);
      expect(first.body.turns[0]).toMatchObject({
        index: 0,
        role: 'user',
        content: 'read the current state',
      });

      const second = await getJson(base, '/api/v1/sessions/claude/sess-mm-cto-working/content?offset=1&limit=1');
      expect(second.status).toBe(200);
      expect(second.body.turns[0]).toMatchObject({
        index: 1,
        role: 'assistant',
        content: 'state reviewed\n\n[tool: sqlite]',
        tool_uses: ['sqlite'],
        usage: { input: 1000, output: 200, cached: 100, reasoning: 50 },
      });
    });
  });

  test('session content API returns 404 for unknown session and warning for missing content', async () => {
    await withApi(async base => {
      const missing = await getJson(base, '/api/v1/sessions/claude/missing/content');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('not_found');

      const empty = await getJson(base, '/api/v1/sessions/codex/sess-mm-devops-idle/content');
      expect(empty.status).toBe(200);
      expect(empty.body.warning).toBe('no content imported');
      expect(empty.body.turns).toEqual([]);
    });
  });

  test('sessions UI routes serve HTML', async () => {
    await withApi(async base => {
      const list = await fetch(`${base}/sessions`);
      expect(list.status).toBe(200);
      const listHtml = await list.text();
      expect(listHtml).toContain('MNEMONIC · SESSIONS');
      expect(listHtml).toContain('window.MM_BASE = "";');
      expect(listHtml).toContain('href="/sessions"');

      const activeUi = await fetch(`${base}/active-ui`);
      expect(activeUi.status).toBe(200);
      expect(await activeUi.text()).toContain('src="/ui/alpine/cdn.min.js"');

      const detail = await fetch(`${base}/sessions/claude/sess-mm-cto-working`);
      expect(detail.status).toBe(200);
      const detailHtml = await detail.text();
      expect(detailHtml).toContain('MNEMONIC · SESSION');
      expect(detailHtml).toContain('href="/sessions"');
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

  test('tokens by participant aggregates across vendors with unpriced visibility', async () => {
    seedParticipantUsageFixtures();
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto');
      expect(status).toBe(200);
      expect(body.participant_id).toBe('ac_cto');
      expect(body.tokens).toEqual({ input: 1700, output: 175, cached: 17, reasoning: 8 });
      expect(body.cost_usd).toBeCloseTo(0.019);
      expect(body.unpriced_session_count).toBe(1);
      expect(body.session_count).toBe(3);
      expect(Object.keys(body.by_vendor)).toEqual(['claude', 'codex', 'gemini']);
      expect(body.by_vendor.claude).toEqual({
        tokens: { input: 1000, output: 100, cached: 10, reasoning: 5 },
        cost_usd: 0.015,
        unpriced_session_count: 0,
        session_count: 1,
      });
      expect(body.by_vendor.codex.cost_usd).toBe(0.004);
      expect(body.by_vendor.gemini).toEqual({
        tokens: { input: 200, output: 25, cached: 2, reasoning: 1 },
        cost_usd: null,
        unpriced_session_count: 1,
        session_count: 1,
      });
      expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test('tokens by participant returns all participants when participant_id is absent', async () => {
    seedParticipantUsageFixtures();
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/tokens/by-participant');
      expect(status).toBe(200);
      expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.participants.map((row: any) => row.participant_id)).toEqual(['ac_cto', 'ac_unpriced']);

      const acCto = body.participants.find((row: any) => row.participant_id === 'ac_cto');
      expect(acCto.tokens).toEqual({ input: 1700, output: 175, cached: 17, reasoning: 8 });
      expect(acCto.cost_usd).toBeCloseTo(0.019);
      expect(acCto.unpriced_session_count).toBe(1);
      expect(acCto.session_count).toBe(3);
      expect(Object.keys(acCto.by_vendor)).toEqual(['claude', 'codex', 'gemini']);

      const unpriced = body.participants.find((row: any) => row.participant_id === 'ac_unpriced');
      expect(unpriced.tokens).toEqual({ input: 100, output: 50, cached: 10, reasoning: 5 });
      expect(unpriced.cost_usd).toBeNull();
      expect(unpriced.unpriced_session_count).toBe(1);
      expect(unpriced.session_count).toBe(1);
      expect(Object.keys(unpriced.by_vendor)).toEqual(['gemini']);
    });
  });

  test('tokens by participant filters by since, window, and vendor', async () => {
    const { since24h } = seedParticipantUsageFixtures();
    await withApi(async base => {
      const since = await getJson(base, `/api/v1/tokens/by-participant?participant_id=ac_cto&since=${encodeURIComponent(since24h)}`);
      expect(since.status).toBe(200);
      expect(since.body.session_count).toBe(2);
      expect(since.body.tokens).toEqual({ input: 1500, output: 150, cached: 15, reasoning: 7 });
      expect(Object.keys(since.body.by_vendor)).toEqual(['claude', 'codex']);

      const windowed = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&window=24h');
      expect(windowed.status).toBe(200);
      expect(windowed.body.session_count).toBe(2);
      expect(windowed.body.tokens).toEqual(since.body.tokens);
      expect(Object.keys(windowed.body.by_vendor)).toEqual(['claude', 'codex']);

      const claude = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&vendor=claude');
      expect(claude.status).toBe(200);
      expect(claude.body.session_count).toBe(1);
      expect(claude.body.tokens).toEqual({ input: 1000, output: 100, cached: 10, reasoning: 5 });
      expect(Object.keys(claude.body.by_vendor)).toEqual(['claude']);
    });
  });

  test('tokens by participant includes exact timestamp boundaries', async () => {
    seedBoundaryUsageFixture();
    await withApi(async base => {
      const until = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_boundary&until=2026-04-22T10%3A00%3A00Z');
      expect(until.status).toBe(200);
      expect(until.body.session_count).toBe(1);
      expect(until.body.tokens).toEqual({ input: 42, output: 7, cached: 3, reasoning: 1 });

      const since = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_boundary&since=2026-04-22T10%3A00%3A00Z');
      expect(since.status).toBe(200);
      expect(since.body.session_count).toBe(1);
      expect(since.body.tokens).toEqual({ input: 42, output: 7, cached: 3, reasoning: 1 });
    });
  });

  test('tokens by participant returns zeros for unknown or empty windows', async () => {
    seedParticipantUsageFixtures();
    await withApi(async base => {
      const unknown = await getJson(base, '/api/v1/tokens/by-participant?participant_id=does_not_exist');
      expect(unknown.status).toBe(200);
      expect(unknown.body).toMatchObject({
        participant_id: 'does_not_exist',
        tokens: { input: 0, output: 0, cached: 0, reasoning: 0 },
        cost_usd: null,
        unpriced_session_count: 0,
        session_count: 0,
        by_vendor: {},
      });

      const future = encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString());
      const emptyWindow = await getJson(base, `/api/v1/tokens/by-participant?participant_id=ac_cto&since=${future}`);
      expect(emptyWindow.status).toBe(200);
      expect(emptyWindow.body.tokens).toEqual({ input: 0, output: 0, cached: 0, reasoning: 0 });
      expect(emptyWindow.body.cost_usd).toBeNull();
      expect(emptyWindow.body.session_count).toBe(0);
      expect(emptyWindow.body.by_vendor).toEqual({});
    });
  });

  test('tokens by participant all-unpriced sessions keep tokens and null cost', async () => {
    seedParticipantUsageFixtures();
    await withApi(async base => {
      const { status, body } = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_unpriced');
      expect(status).toBe(200);
      expect(body.tokens).toEqual({ input: 100, output: 50, cached: 10, reasoning: 5 });
      expect(body.cost_usd).toBeNull();
      expect(body.unpriced_session_count).toBe(1);
      expect(body.session_count).toBe(1);
      expect(body.by_vendor.gemini).toEqual({
        tokens: { input: 100, output: 50, cached: 10, reasoning: 5 },
        cost_usd: null,
        unpriced_session_count: 1,
        session_count: 1,
      });
    });
  });

  test('tokens by participant validates filter params', async () => {
    await withApi(async base => {
      const conflict = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&since=2026-04-22T10%3A00%3A00Z&window=24h');
      expect(conflict.status).toBe(400);
      expect(conflict.body.error.details.conflict).toEqual(['since', 'window']);

      const badSince = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&since=not-a-date');
      expect(badSince.status).toBe(400);
      expect(badSince.body.error.details.value).toBe('not-a-date');

      const badUntil = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&until=not-a-date');
      expect(badUntil.status).toBe(400);
      expect(badUntil.body.error.details.param).toBe('until');

      const badWindow = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&window=6mo');
      expect(badWindow.status).toBe(400);
      expect(badWindow.body.error.details.allowed).toEqual([
        '<positive integer>s',
        '<positive integer>m',
        '<positive integer>h',
        '<positive integer>d',
      ]);

      const hugeWindow = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&window=999999999999999999999999999999999999999d');
      expect(hugeWindow.status).toBe(400);
      expect(hugeWindow.body.error.code).toBe('validation');
      expect(hugeWindow.body.error.details.allowed).toEqual([
        '<positive integer>s',
        '<positive integer>m',
        '<positive integer>h',
        '<positive integer>d',
      ]);

      const badVendor = await getJson(base, '/api/v1/tokens/by-participant?participant_id=ac_cto&vendor=unknown');
      expect(badVendor.status).toBe(400);
      expect(badVendor.body.error.details.allowed).toEqual(['claude', 'codex', 'gemini']);
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

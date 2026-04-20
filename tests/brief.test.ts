import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const BRAIN_TS = path.join(REPO, 'src', 'brain.ts');

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-brief-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'wiki'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'meta'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function brief(project: string, extraEnv: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn(['bun', BRAIN_TS, 'brief', project], {
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return stdout;
}

function openDb(): Database {
  return new Database(path.join(tmpRoot, 'meta', 'brain.db'));
}

async function bootstrapSchema(): Promise<void> {
  // Running any brain command initializes the schema. Cheap bootstrap path.
  const proc = Bun.spawn(['bun', BRAIN_TS, 'projects'], {
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await proc.exited;
}

function seedArtifact(db: Database, type: string, idempotency_key: string, data: Record<string, unknown>) {
  db.prepare(
    `INSERT INTO artifacts (project, type, data, idempotency_key, status)
     VALUES (?, ?, ?, ?, 'active')`
  ).run('mm', type, JSON.stringify(data), idempotency_key);
}

function seedRawEvent(db: Database, id: number, createdAt: string) {
  db.prepare(
    `INSERT INTO raw_events (id, external_id, title, content, source_type, project, timestamp, created_at)
     VALUES (?, ?, ?, ?, 'claude', 'mm', ?, ?)`
  ).run(id, `evt-${id}`, `title-${id}`, 'content', createdAt, createdAt);
}

describe('brief — empty states', () => {
  test('unknown project returns single-line', async () => {
    await bootstrapSchema();
    const md = await brief('ghost');
    expect(md.trim()).toBe('# ghost briefing — no data yet.');
  });
});

describe('brief — sections, caps, and sort', () => {
  test('populated corpus renders expected sections with caps and sort order', async () => {
    await bootstrapSchema();
    const db = openDb();
    try {
      for (let i = 0; i < 15; i++) {
        seedArtifact(db, 'decision', `decision:mm:d${i}`, {
          statement: `decision ${i}`, rationale: `rat ${i}`, area: 'test',
        });
      }
      for (let i = 0; i < 6; i++) {
        seedArtifact(db, 'intent', `intent:mm:session-${i}`, { statement: `session intent ${i}`, horizon: 'session' });
        seedArtifact(db, 'intent', `intent:mm:project-${i}`, { statement: `project intent ${i}`, horizon: 'project' });
      }
      seedArtifact(db, 'bug', 'bug:mm:open-high',   { symptom: 'open high bug',   severity: 'high',   status: 'open' });
      seedArtifact(db, 'bug', 'bug:mm:open-low',    { symptom: 'open low bug',    severity: 'low',    status: 'open' });
      seedArtifact(db, 'bug', 'bug:mm:open-medium', { symptom: 'open medium bug', severity: 'medium', status: 'open' });
      seedArtifact(db, 'bug', 'bug:mm:fixed',       { symptom: 'fixed bug',       severity: 'high',   status: 'fixed' });
      seedArtifact(db, 'bug', 'bug:mm:wontfix',     { symptom: 'wontfix bug',     severity: 'high',   status: 'wontfix' });
      for (let i = 0; i < 10; i++) {
        const freq = i < 3 ? 'Constant' : i < 6 ? 'High' : i < 9 ? 'Occasional' : 'Once';
        seedArtifact(db, 'friction', `friction:mm:f${i}`, { pattern: `friction ${i}`, frequency_estimate: freq, first_seen: '2026-01-01' });
      }
      seedArtifact(db, 'correction', 'correction:mm:c1', { previous_belief: 'old 1', corrected_view: 'new 1', count: 1, last_seen: '2026-04-01' });
      seedArtifact(db, 'correction', 'correction:mm:c2', { previous_belief: 'old 2', corrected_view: 'new 2', count: 2, last_seen: '2026-04-02' });
      seedArtifact(db, 'correction', 'correction:mm:c3', { previous_belief: 'old 3', corrected_view: 'new 3', count: 3, last_seen: '2026-04-03' });
      seedArtifact(db, 'correction', 'correction:mm:c5', { previous_belief: 'old 5', corrected_view: 'new 5', count: 5, last_seen: '2026-04-04' });
      for (let i = 0; i < 12; i++) {
        seedArtifact(db, 'todo', `todo:mm:t${i}`, { statement: `todo ${i}`, effort: 'small', area: 'test' });
      }
      seedRawEvent(db, 1, '2026-04-01 00:00:00');
      seedRawEvent(db, 2, '2026-04-20 18:00:00');
    } finally { db.close(); }

    const md = await brief('mm');

    expect(md).toMatch(/^# mm project briefing — \d{4}-\d{2}-\d{2}T/);
    expect(md).toContain('_Latest raw event: 2026-04-20 18:00:00_');
    expect(md).toContain('## Health');
    expect(md).toContain('- Schema: v11');
    expect(md).toContain('## Recent decisions (last 10)');
    expect(md).toContain('## Intents (10)');
    expect(md).toContain('## Open bugs (3)');
    expect(md).toContain('## Recurring frictions');
    expect(md).toContain('## Corrections above threshold');
    expect(md).toContain('## Recent todos (10)');

    // Caps
    expect((md.match(/^- decision /gm) ?? []).length).toBeLessThanOrEqual(10);
    const todosCount = (md.match(/^- \[small\] todo /gm) ?? []).length;
    expect(todosCount).toBe(10);

    // Bug sort: high before medium before low
    const highIdx    = md.indexOf('[high] open high bug');
    const mediumIdx  = md.indexOf('[medium] open medium bug');
    const lowIdx     = md.indexOf('[low] open low bug');
    expect(highIdx).toBeGreaterThan(-1);
    expect(mediumIdx).toBeGreaterThan(highIdx);
    expect(lowIdx).toBeGreaterThan(mediumIdx);

    // Bugs filtered: fixed + wontfix absent
    expect(md).not.toContain('fixed bug');
    expect(md).not.toContain('wontfix bug');

    // Intent horizon sort: project before session — first intent bullet after the header is "[project]"
    const intentHeaderIdx = md.indexOf('## Intents (10)');
    const afterHeader = md.slice(intentHeaderIdx);
    const firstIntentBullet = afterHeader.split('\n').find((l) => l.startsWith('- ['));
    expect(firstIntentBullet).toContain('[project]');

    // Corrections: only count >= 3 visible; count 5 before count 3
    expect(md).not.toContain('old 1');
    expect(md).not.toContain('old 2');
    const c5Idx = md.indexOf('was: old 5');
    const c3Idx = md.indexOf('was: old 3');
    expect(c5Idx).toBeGreaterThan(-1);
    expect(c3Idx).toBeGreaterThan(c5Idx);

    // Friction: cap 8, Constant before High
    const fConstIdx  = md.indexOf('(Constant');
    const fHighIdx   = md.indexOf('(High');
    expect(fConstIdx).toBeGreaterThan(-1);
    expect(fHighIdx).toBeGreaterThan(fConstIdx);
    expect((md.match(/^- friction /gm) ?? []).length).toBeLessThanOrEqual(8);
  });
});

describe('brief — empty section omission', () => {
  test('only decisions present — other sections omitted', async () => {
    await bootstrapSchema();
    const db = openDb();
    try {
      seedArtifact(db, 'decision', 'decision:mm:solo', { statement: 'solo decision', rationale: 'r', area: 'a' });
      seedRawEvent(db, 1, '2026-04-20 12:00:00');
    } finally { db.close(); }
    const md = await brief('mm');
    expect(md).toContain('## Recent decisions (last 1)');
    expect(md).not.toContain('## Intents');
    expect(md).not.toContain('## Open bugs');
    expect(md).not.toContain('## Recurring frictions');
    expect(md).not.toContain('## Corrections above threshold');
    expect(md).not.toContain('## Recent todos');
  });
});

describe('brief — correction threshold env var', () => {
  test('MT_BRIEF_CORRECTION_THRESHOLD overrides default 3', async () => {
    await bootstrapSchema();
    const db = openDb();
    try {
      seedArtifact(db, 'correction', 'correction:mm:low', { previous_belief: 'old', corrected_view: 'new', count: 2, last_seen: '2026-04-01' });
      seedRawEvent(db, 1, '2026-04-20 12:00:00');
    } finally { db.close(); }
    const mdDefault = await brief('mm');
    expect(mdDefault).not.toContain('## Corrections above threshold');
    const mdLowered = await brief('mm', { MT_BRIEF_CORRECTION_THRESHOLD: '2' });
    expect(mdLowered).toContain('## Corrections above threshold');
    expect(mdLowered).toContain('was: old; now: new (seen 2×, last 2026-04-01)');
  });
});

describe('brief — perf canary', () => {
  test('seeded-fixture getBrief+renderBrief completes under 100ms (in-process)', async () => {
    await bootstrapSchema();
    const db = openDb();
    try {
      for (let i = 0; i < 50; i++) {
        seedArtifact(db, 'decision', `decision:mm:perf-${i}`, { statement: `d${i}`, rationale: `r${i}`, area: 'x' });
        seedArtifact(db, 'todo', `todo:mm:perf-${i}`, { statement: `t${i}`, effort: 'small', area: 'x' });
      }
      seedRawEvent(db, 1, '2026-04-20 20:00:00');
    } finally { db.close(); }

    // Run the in-process timing via a subprocess so MT_BRAIN_ROOT points at tmpRoot.
    // We only measure getBrief+renderBrief, not bun startup.
    const script = `
      import { getBrief, renderBrief } from '${REPO.replace(/\\/g, '\\\\')}/src/core.ts';
      const start = performance.now();
      renderBrief(getBrief('mm'));
      console.log(JSON.stringify({ elapsedMs: performance.now() - start }));
    `;
    const proc = Bun.spawn(['bun', '-e', script], {
      env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const lastLine = out.trim().split('\n').pop() ?? '{}';
    const { elapsedMs } = JSON.parse(lastLine);
    expect(typeof elapsedMs).toBe('number');
    expect(elapsedMs).toBeLessThan(100);
  });
});

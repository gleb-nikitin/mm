#!/usr/bin/env bun
// Gold-chunk skill-tuning runner.
//
// Runs the real librarian (gemini) against a curated fixture in an isolated
// tempdir DB and diffs emitted artifacts against an expected-shape manifest.
// Use this for iterating on meta/skills/ingest.md without wiping the main
// corpus.
//
// COUPLING: the librarian prompt assembled below mirrors process-new.command.
// If process-new.command changes how it builds the prompt (soul file,
// intents/keys/queue expansions, or the `gemini -i=... --yolo` invocation),
// update this file in lock-step — otherwise gold-chunk runs silently drift
// away from production ingest behavior.
//
// Usage:
//   bun scripts/test-gold-chunk.ts [--fixture <path>] [--strict] [--keep-tmp] [--no-librarian]
//
// Default fixture: meta/fixtures/gold-chunk-1.md (paired with
// meta/fixtures/gold-chunk-1-expected.json).
//
// --strict        : fail on unexpected (extra) artifacts, not just missing ones.
// --keep-tmp      : preserve the tempdir on exit (default: kept on fail, cleaned on pass).
// --no-librarian  : seed DB + build prompt + stop; for plumbing verification without spawning gemini.

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const REPO = path.resolve(import.meta.dir, '..');

type ExpectedArtifact = {
  type: string;
  idempotency_key: string;
  required_data_fields: string[];
  alternatives_rejected_min_count?: number;
  status_expected?: string;
  horizon_expected?: string;
  context?: string;
};

type ExpectedManifest = {
  fixture_id: string;
  fixture_version: number;
  counts: Record<string, number>;
  artifacts: ExpectedArtifact[];
  must_not_emit_substrings?: string[];
};

function parseArgs(argv: string[]) {
  const args: { fixture: string; strict: boolean; keepTmp: boolean; noLibrarian: boolean } = {
    fixture: path.join(REPO, 'meta/fixtures/gold-chunk-1.md'),
    strict: false,
    keepTmp: false,
    noLibrarian: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixture') { args.fixture = path.resolve(argv[++i]); continue; }
    if (a === '--strict') { args.strict = true; continue; }
    if (a === '--keep-tmp') { args.keepTmp = true; continue; }
    if (a === '--no-librarian') { args.noLibrarian = true; continue; }
    if (a === '--help' || a === '-h') {
      console.log(`Usage: bun scripts/test-gold-chunk.ts [--fixture <path>] [--strict] [--keep-tmp] [--no-librarian]`);
      process.exit(0);
    }
    console.error(`unknown arg: ${a}`);
    process.exit(2);
  }
  return args;
}

function parseFixture(fixturePath: string): { frontmatter: Record<string, any>; body: string } {
  const text = fs.readFileSync(fixturePath, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`fixture missing frontmatter: ${fixturePath}`);
  const fmText = m[1];
  const body = m[2];
  const frontmatter: Record<string, any> = {};
  for (const line of fmText.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) frontmatter[kv[1]] = kv[2];
  }
  return { frontmatter, body };
}

function loadExpected(fixturePath: string): ExpectedManifest {
  const expectedPath = fixturePath.replace(/\.md$/, '-expected.json');
  if (!fs.existsSync(expectedPath)) throw new Error(`expected file missing: ${expectedPath}`);
  return JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
}

function initBrain(tmpRoot: string) {
  const res = spawnSync('bun', ['run', 'brain', 'artifact', 'list', '--project', 'mm', '--limit', '1'], {
    cwd: REPO,
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    throw new Error(`brain init failed: ${res.stderr?.toString()}`);
  }
}

function seedDb(tmpRoot: string, body: string): number {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  const rawRes = db.prepare(
    `INSERT INTO raw_events (source_type, project, external_id, timestamp, content, title, processed, chunked)
     VALUES ('llm_chat', 'mm', 'gold-chunk-1', datetime('now'), ?, 'Gold chunk 1', 0, 1)`
  ).run(body);
  const rawId = Number(rawRes.lastInsertRowid);

  db.prepare(
    `INSERT INTO chunks_virtual (project, source_event_id, chunk_index, chunk_total, segment_start, segment_end, filter_version)
     VALUES ('mm', ?, 1, 1, 0, ?, 2)`
  ).run(rawId, body.length);
  const chunkId = Number(
    (db.prepare('SELECT last_insert_rowid() as id').get() as any).id
  );
  db.close();
  return chunkId;
}

function captureBrain(tmpRoot: string, argv: string[]): string {
  const res = spawnSync('bun', ['run', 'brain', ...argv], {
    cwd: REPO,
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    throw new Error(`brain ${argv.join(' ')} failed: ${res.stderr?.toString()}`);
  }
  return res.stdout.toString();
}

function buildPrompt(tmpRoot: string): string {
  const soul = fs.readFileSync(path.join(REPO, 'agent/roles/lib/soul-interactive.md'), 'utf8');
  const intents = captureBrain(tmpRoot, ['artifact', 'keys', '--project', 'mm', '--type', 'intent', '--status', 'active', '--limit', '50']);
  const keys = captureBrain(tmpRoot, ['artifact', 'keys', '--project', 'mm', '--status', 'active', '--limit', '500']);
  const queue = captureBrain(tmpRoot, ['chunk', 'queue', '--project', 'mm']);

  return [
    soul,
    '',
    '# CURRENT CONTEXT',
    '',
    '## Active Intents (project: mm)',
    'Durable project-level intents. Align your extraction with them. If a chunk shows a decision that contradicts an intent, emit a supersede on the intent. If an intent is clarified or narrowed, emit a new intent and supersede the old one.',
    '',
    intents.trim(),
    '',
    '## Known Artifacts (project: mm, status=active)',
    "Before emitting, scan this list. If your candidate artifact's idempotency_key is already here, skip it (or call `bump-correction` for corrections). Supersede only when the chunk shows a direct contradiction.",
    '',
    keys.trim(),
    '',
    '## Unprocessed Chunks (project: mm)',
    queue.trim(),
    '',
    '# OBJECTIVE',
    'Drain the unprocessed chunks_virtual queue using the extraction protocol in meta/skills/ingest.md.',
    'For each chunk: `brain chunk read <id>`, scan artifact types, emit one',
    '`brain artifact batch` call, then `brain chunk mark-processed <id>`.',
    'Cross-reference the "Known Artifacts" list above to avoid re-emitting what\'s already there.',
    'No wiki-page edits. No file I/O. Skip chunks with no signal.',
    'Exit when queue is empty or context hits ~80%.',
  ].join('\n');
}

function runLibrarian(tmpRoot: string, prompt: string) {
  const res = spawnSync('gemini', [`-p=${prompt}`, '--yolo'], {
    cwd: REPO,
    env: { ...process.env, MT_BRAIN_ROOT: tmpRoot },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (res.status !== 0) {
    console.error(`gemini exited ${res.status}`);
    process.exit(1);
  }
}

type EmittedArtifact = { type: string; idempotency_key: string; data: Record<string, any> };

function readEmitted(tmpRoot: string): EmittedArtifact[] {
  const dbPath = path.join(tmpRoot, 'meta', 'brain.db');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(
    `SELECT type, idempotency_key, data FROM artifacts WHERE project = 'mm' AND status = 'active' ORDER BY type, idempotency_key`
  ).all() as Array<{ type: string; idempotency_key: string; data: string }>;
  db.close();
  return rows.map(r => ({ type: r.type, idempotency_key: r.idempotency_key, data: JSON.parse(r.data) }));
}

type DiffReport = {
  passed: boolean;
  countsMismatch: Array<{ type: string; expected: number; actual: number }>;
  missing: ExpectedArtifact[];
  extras: EmittedArtifact[];
  fieldProblems: Array<{ key: string; issue: string }>;
  skipLeaks: Array<{ key: string; substring: string }>;
};

function diff(expected: ExpectedManifest, emitted: EmittedArtifact[], strict: boolean): DiffReport {
  const report: DiffReport = {
    passed: true,
    countsMismatch: [],
    missing: [],
    extras: [],
    fieldProblems: [],
    skipLeaks: [],
  };

  const actualCounts: Record<string, number> = {};
  for (const a of emitted) actualCounts[a.type] = (actualCounts[a.type] ?? 0) + 1;
  for (const [type, n] of Object.entries(expected.counts)) {
    const got = actualCounts[type] ?? 0;
    if (got !== n) {
      report.countsMismatch.push({ type, expected: n, actual: got });
      report.passed = false;
    }
  }

  const emittedByKey = new Map<string, EmittedArtifact>();
  for (const a of emitted) emittedByKey.set(a.idempotency_key, a);

  const claimed = new Set<string>();
  for (const exp of expected.artifacts) {
    const got = emittedByKey.get(exp.idempotency_key);
    if (!got) {
      report.missing.push(exp);
      report.passed = false;
      continue;
    }
    claimed.add(exp.idempotency_key);
    for (const field of exp.required_data_fields) {
      if (!(field in got.data)) {
        report.fieldProblems.push({ key: exp.idempotency_key, issue: `missing data.${field}` });
        report.passed = false;
      }
    }
    if (exp.alternatives_rejected_min_count !== undefined) {
      const ar = got.data.alternatives_rejected;
      if (!Array.isArray(ar) || ar.length < exp.alternatives_rejected_min_count) {
        report.fieldProblems.push({ key: exp.idempotency_key, issue: `alternatives_rejected has ${Array.isArray(ar) ? ar.length : 'none'}, expected ≥${exp.alternatives_rejected_min_count}` });
        report.passed = false;
      }
    }
    if (exp.status_expected && got.data.status !== exp.status_expected) {
      report.fieldProblems.push({ key: exp.idempotency_key, issue: `status=${got.data.status}, expected ${exp.status_expected}` });
      report.passed = false;
    }
    if (exp.horizon_expected && got.data.horizon !== exp.horizon_expected) {
      report.fieldProblems.push({ key: exp.idempotency_key, issue: `horizon=${got.data.horizon}, expected ${exp.horizon_expected}` });
      report.passed = false;
    }
  }

  for (const a of emitted) {
    if (!claimed.has(a.idempotency_key)) report.extras.push(a);
  }
  if (strict && report.extras.length > 0) report.passed = false;

  if (expected.must_not_emit_substrings) {
    for (const a of emitted) {
      const blob = JSON.stringify(a.data);
      for (const s of expected.must_not_emit_substrings) {
        if (blob.includes(s)) {
          report.skipLeaks.push({ key: a.idempotency_key, substring: s });
          report.passed = false;
        }
      }
    }
  }

  return report;
}

function printReport(report: DiffReport, expected: ExpectedManifest, emitted: EmittedArtifact[]) {
  console.log(`\n=== Gold chunk report: ${expected.fixture_id} v${expected.fixture_version} ===`);
  console.log(`Emitted: ${emitted.length}   Expected: ${expected.artifacts.length}   Strict extras: ${report.extras.length > 0 ? 'fail' : 'ok'}`);

  if (report.countsMismatch.length > 0) {
    console.log(`\n✗ Count mismatches:`);
    for (const m of report.countsMismatch) console.log(`  ${m.type}: expected ${m.expected}, got ${m.actual}`);
  }

  if (report.missing.length > 0) {
    console.log(`\n✗ Missing expected artifacts (${report.missing.length}):`);
    for (const m of report.missing) console.log(`  ${m.idempotency_key}`);
  }

  if (report.fieldProblems.length > 0) {
    console.log(`\n✗ Field problems (${report.fieldProblems.length}):`);
    for (const f of report.fieldProblems) console.log(`  ${f.key}: ${f.issue}`);
  }

  if (report.skipLeaks.length > 0) {
    console.log(`\n✗ Skip-band leaks (content that should not have been extracted):`);
    for (const s of report.skipLeaks) console.log(`  ${s.key}: contains "${s.substring}"`);
  }

  if (report.extras.length > 0) {
    console.log(`\n? Extras (emitted but not in expected; informational unless --strict):`);
    for (const e of report.extras) console.log(`  ${e.idempotency_key} (${e.type})`);
  }

  if (report.passed) {
    console.log(`\n✓ PASS`);
  } else {
    console.log(`\n✗ FAIL`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { body } = parseFixture(args.fixture);
  const expected = loadExpected(args.fixture);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gold-chunk-'));
  let passed = false;
  try {
    console.log(`tmpdir: ${tmpRoot}`);
    initBrain(tmpRoot);
    const chunkId = seedDb(tmpRoot, body);
    console.log(`seeded chunk id: ${chunkId}`);

    const prompt = buildPrompt(tmpRoot);

    if (args.noLibrarian) {
      console.log(`prompt length: ${prompt.length} chars`);
      console.log(`--- plumbing verified, skipping librarian per --no-librarian ---`);
      passed = true;
      return;
    }

    runLibrarian(tmpRoot, prompt);
    const emitted = readEmitted(tmpRoot);
    const report = diff(expected, emitted, args.strict);
    printReport(report, expected, emitted);
    passed = report.passed;
  } finally {
    if (args.keepTmp || !passed) {
      console.log(`tmpdir preserved at ${tmpRoot}`);
    } else {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  process.exit(passed ? 0 : 1);
}

main();

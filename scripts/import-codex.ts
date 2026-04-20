/**
 * Import Codex session transcripts directly into `raw_events`.
 *
 * Walks `~/.codex/sessions/*.jsonl` (or `--sessions-dir <path>` for testing),
 * filters by mtime + min-turns + project substring, flattens each session into
 * a single clean transcript, and inserts one row per session. Dedup is via
 * `external_id UNIQUE` (the Codex session id) + `INSERT OR IGNORE`.
 *
 * Search-visible immediately via `events_fts`. Ingestion into wiki is a
 * separate, later, targeted pass — this importer's job is only to land all
 * sessions cleanly.
 *
 * No filesystem writes under raw/; no `addToBrain`; no per-turn headers; no
 * `[tool: X]` markers. User/assistant turns are inlined as plain speaker
 * markers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDb, db, upsertRawEvent } from '../src/core.ts';

type Flags = {
  days: number;
  project: string | null;
  minTurns: number;
  minAgeSeconds: number;
  includeThinking: boolean;
  dryRun: boolean;
  force: boolean;
  sessionsDir: string | null;
};

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string };

type Turn = {
  role: 'user' | 'assistant';
  timestamp: string;
  blocks: Block[];
};

type Session = {
  sessionId: string;
  cwd: string | null;
  model: string | null;
  turns: Turn[];
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    days: 30,
    project: null,
    minTurns: 2,
    minAgeSeconds: 300,
    includeThinking: false,
    dryRun: false,
    force: false,
    sessionsDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--days') flags.days = parseInt(argv[++i], 10);
    else if (arg === '--project') flags.project = argv[++i];
    else if (arg === '--min-turns') flags.minTurns = parseInt(argv[++i], 10);
    else if (arg === '--min-age-seconds') flags.minAgeSeconds = parseInt(argv[++i], 10);
    else if (arg === '--include-thinking') flags.includeThinking = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--sessions-dir') flags.sessionsDir = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  if (isNaN(flags.days) || flags.days < 0) {
    console.error('--days must be a non-negative integer');
    process.exit(1);
  }
  if (isNaN(flags.minTurns) || flags.minTurns < 0) {
    console.error('--min-turns must be a non-negative integer');
    process.exit(1);
  }
  if (isNaN(flags.minAgeSeconds) || flags.minAgeSeconds < 0) {
    console.error('--min-age-seconds must be a non-negative integer');
    process.exit(1);
  }
  return flags;
}

function printHelp() {
  console.log(`Usage: bun scripts/import-codex.ts [flags]

Flags:
  --days N                Only sessions with mtime >= today - N  (default: 30)
  --project <substr>      Filter by cwd substring
  --min-turns N           Skip sessions with fewer user turns     (default: 2)
  --min-age-seconds N     Skip files modified in the last N sec   (default: 300)
  --include-thinking      Include assistant thinking blocks       (default: off)
  --force                 Ignore settled/unchanged checks
  --sessions-dir <path>   Override ~/.codex/sessions              (testing)
  --dry-run               List what would import, write nothing
  -h, --help              Show this help
`);
}

function projectNameFromCwd(cwd: string | null | undefined): string {
  if (!cwd) return 'unknown';
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return parts[parts.length - 1] || 'unknown';
}

function projectSlugFromCwd(cwd: string | null | undefined): string {
  if (!cwd) return 'unknown';
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function collectRolloutFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function getRecordTimestamp(rec: any): string {
  return typeof rec?.timestamp === 'string' ? rec.timestamp : '';
}

function extractAssistantText(content: any): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'output_text' && typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }
  return parts.join('\n\n');
}

function extractReasoningText(summary: any): string {
  if (!Array.isArray(summary)) return '';
  const parts: string[] = [];
  for (const item of summary) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'summary_text' && typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }
  return parts.join('\n\n');
}

function parseRolloutFile(filePath: string, includeThinking: boolean): Session | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let model: string | null = null;
  const turns: Turn[] = [];
  const pendingThinking: Block[] = [];

  const flushPendingThinking = () => {
    pendingThinking.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const recordType = rec?.type;
    const timestamp = getRecordTimestamp(rec);
    const payload = rec?.payload || {};

    if (recordType === 'session_meta') {
      if (typeof payload.id === 'string' && payload.id) sessionId = payload.id;
      if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
      if (typeof payload.model === 'string' && payload.model) model = payload.model;
      continue;
    }

    if (recordType === 'event_msg' && payload.type === 'user_message') {
      const message = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (message) {
        flushPendingThinking();
        turns.push({
          role: 'user',
          timestamp,
          blocks: [{ kind: 'text', text: message }],
        });
      }
      continue;
    }

    if (recordType === 'response_item' && payload.type === 'reasoning' && includeThinking) {
      const reasoning = extractReasoningText(payload.summary);
      if (reasoning) pendingThinking.push({ kind: 'thinking', text: reasoning });
      continue;
    }

    if (recordType === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const text = extractAssistantText(payload.content);
      if (!text) continue;

      const blocks: Block[] = [];
      if (pendingThinking.length > 0) blocks.push(...pendingThinking);
      blocks.push({ kind: 'text', text });
      turns.push({
        role: 'assistant',
        timestamp,
        blocks,
      });
      flushPendingThinking();
      continue;
    }
  }

  if (!sessionId) return null;
  turns.sort((a, b) => (a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0));
  return { sessionId, cwd, model, turns };
}

function flattenSession(session: Session): { title: string; content: string; userTurnCount: number; started: string; ended: string } {
  const proj = projectNameFromCwd(session.cwd);
  const shortId = session.sessionId.slice(0, 8);
  const title = `Codex Session — ${proj} — ${shortId}`;
  const started = session.turns[0]?.timestamp || '';
  const ended = session.turns[session.turns.length - 1]?.timestamp || '';
  const userTurnCount = session.turns.filter(t => t.role === 'user').length;

  const parts: string[] = [];
  for (const turn of session.turns) {
    const role = turn.role === 'user' ? 'User' : 'Assistant';
    const body = turn.blocks.map(block => {
      if (block.kind === 'text') return block.text.trim();
      if (block.kind === 'thinking') return `_thinking_: ${block.text.trim()}`;
      return '';
    }).filter(Boolean).join('\n\n');
    if (body) parts.push(`${role}: ${body}`);
  }

  return { title, content: parts.join('\n\n'), userTurnCount, started, ended };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const sessionsDir = flags.sessionsDir || path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    console.error(`Codex sessions dir not found: ${sessionsDir}`);
    process.exit(1);
  }

  initDb();

  const cutoffMs = flags.days > 0 ? Date.now() - flags.days * 24 * 60 * 60 * 1000 : 0;
  const candidateFiles: { path: string; mtimeMs: number }[] = [];

  for (const filePath of collectRolloutFiles(sessionsDir)) {
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs < cutoffMs) continue;
      candidateFiles.push({ path: filePath, mtimeMs: st.mtimeMs });
    } catch {
      continue;
    }
  }

  console.log(`Found ${candidateFiles.length} jsonl files within --days ${flags.days}.`);

  const selectImportState = db.prepare(`SELECT last_mtime FROM import_state WHERE source_path = ?`);
  const upsertImportState = flags.dryRun ? null : db.prepare(`INSERT INTO import_state
    (source_path, last_mtime, last_imported_at, provider, external_id, project, cwd, model, last_user_snippet, min_turns_ok)
    VALUES (?, ?, CURRENT_TIMESTAMP, 'codex', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      last_mtime = excluded.last_mtime,
      last_imported_at = excluded.last_imported_at,
      provider = excluded.provider,
      external_id = COALESCE(excluded.external_id, external_id),
      project = COALESCE(excluded.project, project),
      cwd = COALESCE(excluded.cwd, cwd),
      model = COALESCE(excluded.model, model),
      last_user_snippet = excluded.last_user_snippet,
      min_turns_ok = excluded.min_turns_ok`);
  let imported = 0;
  let updated = 0;
  let skippedProject = 0;
  let skippedMinTurns = 0;
  let skippedLive = 0;
  let skippedUnchanged = 0;
  let duplicate = 0;
  let errored = 0;

  for (const { path: filePath, mtimeMs } of candidateFiles) {
    const isSettled = (Date.now() - mtimeMs) / 1000 >= flags.minAgeSeconds;
    const state = selectImportState.get(filePath) as { last_mtime: number } | undefined;
    const isChanged = !state || state.last_mtime !== mtimeMs;

    let session: Session | null;
    try {
      session = parseRolloutFile(filePath, flags.includeThinking);
    } catch (e: any) {
      errored++;
      console.error(`  ✗ parse error: ${filePath}: ${e.message}`);
      continue;
    }

    if (!session) {
      // Still update sighting if we have a valid path but failed to parse as full session
      if (!flags.dryRun) {
        upsertImportState!.run(filePath, mtimeMs, null, 'unknown', null, null, null, 0);
      }
      continue;
    }

    const projectSlug = projectSlugFromCwd(session.cwd);
    const userTurns = session.turns.filter(t => t.role === 'user');
    const userTurnCount = userTurns.length;
    const minTurnsOk = userTurnCount >= flags.minTurns ? 1 : 0;
    
    // Snippet is the most recent turn of either role that actually has
    // text content. Skips tool-only or otherwise text-less turns so the
    // dashboard doesn't show a blank line.
    let lastUserSnippet: string | null = null;
    for (let i = session.turns.length - 1; i >= 0; i--) {
      const text = session.turns[i].blocks.filter(b => b.kind === 'text').map(b => b.text).join(' ').trim();
      if (text) { lastUserSnippet = text.slice(0, 200); break; }
    }

    if (!flags.dryRun) {
      upsertImportState!.run(
        filePath, 
        mtimeMs, 
        session.sessionId, 
        projectSlug, 
        session.cwd, 
        session.model, 
        lastUserSnippet, 
        minTurnsOk
      );
    }

    if (!flags.force && isSettled && !isChanged) {
      skippedUnchanged++;
      continue;
    }

    if (flags.project && !(session.cwd || '').includes(flags.project)) {
      skippedProject++;
      continue;
    }

    if (userTurnCount < flags.minTurns) {
      skippedMinTurns++;
      continue;
    }

    if (!flags.force && !isSettled) {
      skippedLive++;
      continue;
    }

    const { title, content, started, ended } = flattenSession(session);
    if (flags.dryRun) {
      console.log(`  [dry-run] ${title}  ->  raw_events  (${session.turns.length} turns, ${content.length} chars)`);
      imported++;
      continue;
    }

    const metadata = JSON.stringify({
      provider: 'codex',
      source_path: filePath,
      model: session.model,
      cwd: session.cwd,
      started,
      ended,
      turn_count: session.turns.length,
      user_turn_count: userTurnCount,
    });
    const res = upsertRawEvent({
      source_type: 'llm_chat',
      project: projectSlug,
      external_id: session.sessionId,
      timestamp: started || new Date().toISOString(),
      content,
      title,
      participants: JSON.stringify(['user', 'assistant']),
      metadata,
    });
    if (res === 'inserted') {
      imported++;
      console.log(`  OK ${title}  ->  raw_events`);
    } else if (res === 'updated') {
      updated++;
      console.log(`  UP ${title}  ->  raw_events (updated, chunks reset)`);
    } else {
      duplicate++;
    }
  }

  console.log();
  console.log(`Summary:`);
  console.log(`  imported:          ${imported}${flags.dryRun ? ' (dry-run)' : ''}`);
  console.log(`  updated:           ${updated}`);
  console.log(`  duplicate (dedup): ${duplicate}`);
  console.log(`  skipped (project): ${skippedProject}`);
  console.log(`  skipped (turns):   ${skippedMinTurns}`);
  console.log(`  skipped (live):    ${skippedLive}`);
  console.log(`  skipped (unchanged): ${skippedUnchanged}`);
  if (errored > 0) console.log(`  parse errors:      ${errored}`);
  if (!flags.dryRun && imported > 0) {
    console.log();
    console.log(`Run 'bun run brain search <query>' to search imported sessions.`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

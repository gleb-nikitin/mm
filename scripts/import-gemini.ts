/**
 * Import Gemini session transcripts directly into `raw_events`.
 *
 * Walks session files under `~/.gemini/tmp/<project>/chats/session-*.json`
 * (or `--sessions-dir <path>` for
 * testing), filters by mtime + min-turns + project substring, flattens each
 * session into a single clean transcript, and inserts one row per session.
 * `raw_events` stores `external_id` as `gemini:<session_id>` to avoid
 * cross-vendor collisions; `import_state.external_id` intentionally keeps the
 * raw session id so `/active` and ac `participants.active_session_id` matching stays compatible.
 *
 * Search-visible immediately via `events_fts`. Ingestion into wiki is a
 * separate, later, targeted pass — this importer's job is only to land all
 * sessions cleanly.
 *
 * No filesystem writes under raw/; no `addToBrain`; no per-turn headers; no
 * tool-call markers. User/assistant turns are inlined as plain speaker markers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDb, db, upsertRawEvent } from '../src/core.ts';
import { findRawEventIdByExternalId, recordSessionObservation, recordSessionUsage } from '../src/r1/session-index.ts';
import { extractGeminiTokenUsage } from '../src/r1/token-usage.ts';

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

type GeminiMessage = {
  id?: string;
  timestamp?: string;
  type?: string;
  content?: unknown;
  thoughts?: Array<{ subject?: string; description?: string; timestamp?: string }>;
  model?: string;
};

type GeminiSessionFile = {
  sessionId?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
};

type Session = {
  sessionId: string;
  project: string;
  model: string | null;
  turns: Turn[];
  startTime: string;
  lastUpdated: string;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    days: 30,
    project: null,
    minTurns: 3,
    minAgeSeconds: 0,
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
  console.log(`Usage: bun scripts/import-gemini.ts [flags]

Flags:
  --days N                Only sessions with mtime >= today - N  (default: 30)
  --project <substr>      Filter by project substring
  --min-turns N           Skip sessions with fewer user turns     (default: 3)
  --min-age-seconds N     Skip files modified in the last N sec   (default: 0)
  --include-thinking      Include assistant thinking blocks       (default: off)
  --force                 Ignore settled/unchanged checks
  --sessions-dir <path>   Override ~/.gemini/tmp                 (testing)
  --dry-run               List what would import, write nothing
  -h, --help              Show this help
`);
}

function collectSessionFiles(root: string): string[] {
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
      } else if (entry.isFile() && /^session-.*\.(json|jsonl)$/.test(entry.name)) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function projectFromFilePath(filePath: string): string {
  const chatsDir = path.dirname(filePath);
  return path.basename(path.dirname(chatsDir)) || 'unknown';
}

function extractUserText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const text = (item as { text?: unknown }).text;
        return typeof text === 'string' ? text.trim() : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof content === 'string') return content.trim();
  return '';
}

function extractThinkingText(thoughts: GeminiMessage['thoughts']): string[] {
  if (!Array.isArray(thoughts)) return [];
  return thoughts
    .map(thought => {
      const subject = typeof thought?.subject === 'string' ? thought.subject.trim() : '';
      const description = typeof thought?.description === 'string' ? thought.description.trim() : '';
      if (subject && description) return `${subject}: ${description}`;
      return description || subject;
    })
    .filter(Boolean);
}

function parseSessionFile(filePath: string, includeThinking: boolean): Session | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: GeminiSessionFile;
  let lines: any[] = [];
  try {
    parsed = JSON.parse(raw);
    lines = [parsed];
  } catch {
    // Try JSONL
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
    if (lines.length === 0) return null;
    // For JSONL, we pick the first record to find sessionId, or fallback to filename
    parsed = lines[0];
  }

  const sessionId = parsed.sessionId || path.basename(filePath).replace(/^session-/, '').replace(/\.(json|jsonl)$/, '') || 'unknown';
  const project = projectFromFilePath(filePath);
  const turns: Turn[] = [];
  let model: string | null = null;
  let startTime = typeof parsed.startTime === 'string' ? parsed.startTime : '';
  let lastUpdated = typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : '';

  for (const rec of lines) {
    const messages = Array.isArray(rec.messages) ? rec.messages : [rec];
    for (const message of messages) {
      const type = message?.type;
      const timestamp =
        typeof message?.timestamp === 'string' ? message.timestamp :
        typeof rec.timestamp === 'string' ? rec.timestamp :
        typeof rec.lastUpdated === 'string' ? rec.lastUpdated :
        typeof rec.startTime === 'string' ? rec.startTime :
        '';

      if (!startTime && typeof rec.startTime === 'string') startTime = rec.startTime;
      if (typeof rec.lastUpdated === 'string') lastUpdated = rec.lastUpdated;

      if (type === 'user') {
        const text = extractUserText(message.content);
        if (!text) continue;
        turns.push({
          role: 'user',
          timestamp,
          blocks: [{ kind: 'text', text }],
        });
        continue;
      }

      if (type === 'gemini' || message?.usageMetadata) {
        if (!model && typeof message.model === 'string' && message.model.trim()) {
          model = message.model.trim();
        }
        const blocks: Block[] = [];
        if (includeThinking) {
          for (const thought of extractThinkingText(message.thoughts)) {
            blocks.push({ kind: 'thinking', text: thought });
          }
        }
        const text = typeof message.content === 'string' ? message.content.trim() : '';
        if (text) blocks.push({ kind: 'text', text });
        if (blocks.length === 0 && !message?.usageMetadata) continue;
        turns.push({
          role: 'assistant',
          timestamp,
          blocks,
        });
        continue;
      }
    }
  }

  if (turns.length === 0) return null;

  turns.sort((a, b) => (a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0));
  return {
    sessionId,
    project,
    model,
    turns,
    startTime,
    lastUpdated,
  };
}

function flattenSession(session: Session): { title: string; content: string; userTurnCount: number; started: string; ended: string } {
  const shortId = session.sessionId.slice(0, 8);
  const title = `Gemini Session — ${session.project} — ${shortId}`;
  const started = session.startTime || session.turns[0]?.timestamp || '';
  const ended = session.lastUpdated || session.turns[session.turns.length - 1]?.timestamp || '';
  const userTurnCount = session.turns.filter(turn => turn.role === 'user').length;

  const parts: string[] = [];
  for (const turn of session.turns) {
    const role = turn.role === 'user' ? 'User' : 'Assistant';
    const body = turn.blocks
      .map(block => {
        if (block.kind === 'text') return block.text.trim();
        if (block.kind === 'thinking') return `_thinking_: ${block.text.trim()}`;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (body) parts.push(`${role}: ${body}`);
  }

  return { title, content: parts.join('\n\n'), userTurnCount, started, ended };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const sessionsDir = flags.sessionsDir || path.join(os.homedir(), '.gemini', 'tmp');
  if (!fs.existsSync(sessionsDir)) {
    console.error(`Gemini sessions dir not found: ${sessionsDir}`);
    process.exit(1);
  }

  initDb();

  const cutoffMs = flags.days > 0 ? Date.now() - flags.days * 24 * 60 * 60 * 1000 : 0;
  const candidateFiles: { path: string; mtimeMs: number }[] = [];

  for (const filePath of collectSessionFiles(sessionsDir)) {
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs < cutoffMs) continue;
      candidateFiles.push({ path: filePath, mtimeMs: st.mtimeMs });
    } catch {
      continue;
    }
  }

  console.log(`Found ${candidateFiles.length} json files within --days ${flags.days}.`);

  const selectImportState = db.prepare(`SELECT last_mtime FROM import_state WHERE source_path = ?`);
  const upsertImportState = flags.dryRun ? null : db.prepare(`INSERT INTO import_state
    (source_path, last_mtime, last_imported_at, provider, external_id, project, cwd, model, last_user_snippet, min_turns_ok)
    VALUES (?, ?, CURRENT_TIMESTAMP, 'gemini', ?, ?, ?, ?, ?, ?)
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

    if (!flags.force && isSettled && !isChanged) {
      skippedUnchanged++;
      continue;
    }

    let session: Session | null;
    try {
      session = parseSessionFile(filePath, flags.includeThinking);
    } catch (e: any) {
      errored++;
      console.error(`  ✗ parse error: ${filePath}: ${e.message}`);
      continue;
    }

    if (!session) {
      if (!flags.dryRun) upsertImportState!.run(filePath, mtimeMs, null, 'unknown', null, null, null, 0);
      continue;
    }

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
        session.project, 
        null, // Gemini doesn't have cwd
        session.model, 
        lastUserSnippet, 
        minTurnsOk
      );
    }

    if (flags.project && !session.project.includes(flags.project)) {
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
      provider: 'gemini',
      session_id: session.sessionId,
      source_path: filePath,
      model: session.model,
      project: session.project,
      started,
      ended,
      turn_count: session.turns.length,
      user_turn_count: userTurnCount,
    });
    const namespacedExternalId = `gemini:${session.sessionId}`;
    const res = upsertRawEvent({
      source_type: 'llm_chat',
      project: session.project,
      external_id: namespacedExternalId,
      timestamp: started || new Date().toISOString(),
      content,
      title,
      participants: JSON.stringify(['user', 'assistant']),
      metadata,
    });
    recordSessionObservation({
      vendor: 'gemini',
      session_id: session.sessionId,
      source_path: filePath,
      raw_event_id: findRawEventIdByExternalId(namespacedExternalId),
      project: session.project,
      cwd: null,
      model: session.model,
      started_at: started || null,
      last_activity_at: ended || started || new Date().toISOString(),
      last_mtime: mtimeMs,
      last_log_line: lastUserSnippet,
      metadata,
    }, content);
    recordSessionUsage('gemini', session.sessionId, extractGeminiTokenUsage(filePath), session.model);
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

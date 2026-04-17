/**
 * Import Claude Code session transcripts into the brain.
 *
 * Walks `~/.claude/projects/*.jsonl`, filters by mtime + min-turns + project substring,
 * normalizes user/assistant content blocks (skipping tool_result noise and collapsing
 * tool_use to one-liners), and writes one markdown file per session to `raw/`.
 *
 * Content-block flattening logic is ported from the Python reference at
 * `claude-usage/scanner.py::get_session_transcript`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDb, addToBrain, PATHS } from '../src/core.ts';

type Flags = {
  days: number;
  project: string | null;
  minTurns: number;
  includeThinking: boolean;
  dryRun: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    days: 30,
    project: null,
    minTurns: 2,
    includeThinking: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--days') flags.days = parseInt(argv[++i], 10);
    else if (arg === '--project') flags.project = argv[++i];
    else if (arg === '--min-turns') flags.minTurns = parseInt(argv[++i], 10);
    else if (arg === '--include-thinking') flags.includeThinking = true;
    else if (arg === '--dry-run') flags.dryRun = true;
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
  return flags;
}

function printHelp() {
  console.log(`Usage: bun scripts/import-claude.ts [flags]

Flags:
  --days N             Only sessions with mtime >= today - N  (default: 30)
  --project <substr>   Filter by decoded cwd substring        (e.g. "work/code/mm")
  --min-turns N        Skip sessions with fewer user turns    (default: 2)
  --include-thinking   Include assistant thinking blocks      (default: off)
  --dry-run            List what would import, write nothing
  -h, --help           Show this help
`);
}

// Decode the encoded project dir name used under ~/.claude/projects
// e.g. "-Users-glebnikitin-work-code-mm" -> "/Users/glebnikitin/work/code/mm"
function decodeProjectDir(name: string): string {
  return name.replace(/-/g, '/');
}

function projectNameFromCwd(cwd: string | null | undefined): string {
  if (!cwd) return 'unknown';
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return parts[parts.length - 1] || 'unknown';
}

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; name: string };

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

function normalizeUserContent(raw: any): Block[] {
  const out: Block[] = [];
  if (typeof raw === 'string') {
    if (raw.trim()) out.push({ kind: 'text', text: raw });
    return out;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
        out.push({ kind: 'text', text: item.text });
      }
      // tool_result blocks are deliberately skipped — they are usually file
      // contents or long tool outputs that duplicate existing raw material.
    }
  }
  return out;
}

function normalizeAssistantContent(raw: any, includeThinking: boolean): Block[] {
  const out: Block[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      out.push({ kind: 'text', text: item.text });
    } else if (item.type === 'thinking' && includeThinking) {
      const t = typeof item.thinking === 'string' ? item.thinking : '';
      if (t.trim()) out.push({ kind: 'thinking', text: t });
    } else if (item.type === 'tool_use') {
      out.push({ kind: 'tool_use', name: typeof item.name === 'string' ? item.name : '?' });
    }
  }
  return out;
}

function parseJsonlFile(filePath: string, includeThinking: boolean): Session[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const bySession = new Map<string, Session>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const sid = rec.sessionId;
    if (!sid) continue;

    let session = bySession.get(sid);
    if (!session) {
      session = { sessionId: sid, cwd: null, model: null, turns: [] };
      bySession.set(sid, session);
    }

    if (rec.cwd && !session.cwd) session.cwd = rec.cwd;

    const rtype = rec.type;
    if (rtype !== 'user' && rtype !== 'assistant') continue;

    const msg = rec.message || {};
    const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : '';

    if (rtype === 'user') {
      const blocks = normalizeUserContent(msg.content);
      if (blocks.length > 0) {
        session.turns.push({ role: 'user', timestamp, blocks });
      }
    } else {
      // assistant
      if (msg.model && !session.model) session.model = msg.model;
      const blocks = normalizeAssistantContent(msg.content, includeThinking);
      if (blocks.length > 0) {
        session.turns.push({ role: 'assistant', timestamp, blocks });
      }
    }
  }

  // Sort turns per session by timestamp for stable ordering
  for (const s of bySession.values()) {
    s.turns.sort((a, b) => (a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0));
  }

  return Array.from(bySession.values());
}

function renderTurn(turn: Turn): string {
  const short = turn.timestamp ? turn.timestamp.replace('T', ' ').replace(/\.\d+Z?$/, '') : '';
  const header = `## ${turn.role === 'user' ? 'User' : 'Assistant'}${short ? ` — ${short}` : ''}`;
  const body = turn.blocks.map(b => {
    if (b.kind === 'text') return b.text.trim();
    if (b.kind === 'thinking') return `> _thinking_\n> ${b.text.trim().split('\n').join('\n> ')}`;
    if (b.kind === 'tool_use') return `\`[tool: ${b.name}]\``;
    return '';
  }).filter(Boolean).join('\n\n');
  return `${header}\n\n${body}`;
}

function renderSession(session: Session): { title: string; body: string; userTurnCount: number } {
  const proj = projectNameFromCwd(session.cwd);
  const shortId = session.sessionId.slice(0, 8);
  const title = `Claude Session — ${proj} — ${shortId}`;
  const first = session.turns[0]?.timestamp || '';
  const last = session.turns[session.turns.length - 1]?.timestamp || '';
  const userTurnCount = session.turns.filter(t => t.role === 'user').length;

  const metaLines = [
    `- session_id: ${session.sessionId}`,
    `- project: ${session.cwd || 'unknown'}`,
    session.model ? `- model: ${session.model}` : null,
    `- started: ${first}`,
    `- ended: ${last}`,
    `- turns: ${session.turns.length} (user: ${userTurnCount})`,
  ].filter(Boolean).join('\n');

  const body = `${metaLines}\n\n---\n\n${session.turns.map(renderTurn).join('\n\n')}\n`;
  return { title, body, userTurnCount };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) {
    console.error(`Claude projects dir not found: ${projectsDir}`);
    process.exit(1);
  }

  if (!flags.dryRun) initDb();

  const cutoffMs = flags.days > 0 ? Date.now() - flags.days * 24 * 60 * 60 * 1000 : 0;

  // Walk projects dir for .jsonl files
  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const candidateFiles: { path: string; mtimeMs: number }[] = [];
  for (const proj of projectDirs) {
    const dir = path.join(projectsDir, proj);
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const p = path.join(dir, entry);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs < cutoffMs) continue;
        candidateFiles.push({ path: p, mtimeMs: st.mtimeMs });
      } catch {
        continue;
      }
    }
  }

  console.log(`Found ${candidateFiles.length} jsonl files within --days ${flags.days}.`);

  let imported = 0;
  let skippedProject = 0;
  let skippedMinTurns = 0;
  let duplicate = 0;
  let errored = 0;

  for (const { path: filePath } of candidateFiles) {
    let sessions: Session[];
    try {
      sessions = parseJsonlFile(filePath, flags.includeThinking);
    } catch (e: any) {
      errored++;
      console.error(`  ✗ parse error: ${filePath}: ${e.message}`);
      continue;
    }

    for (const session of sessions) {
      if (flags.project && !(session.cwd || '').includes(flags.project)) {
        skippedProject++;
        continue;
      }
      const userTurnCount = session.turns.filter(t => t.role === 'user').length;
      if (userTurnCount < flags.minTurns) {
        skippedMinTurns++;
        continue;
      }

      const { title, body } = renderSession(session);
      if (flags.dryRun) {
        console.log(`  [dry-run] ${title} (${session.turns.length} turns)`);
        imported++;
        continue;
      }

      const res = addToBrain(body, title);
      if (res.status === 'duplicate') {
        duplicate++;
      } else {
        imported++;
        console.log(`  ✔ ${title}`);
      }
    }
  }

  console.log();
  console.log(`Summary:`);
  console.log(`  imported:          ${imported}${flags.dryRun ? ' (dry-run)' : ''}`);
  console.log(`  duplicate (dedup): ${duplicate}`);
  console.log(`  skipped (project): ${skippedProject}`);
  console.log(`  skipped (turns):   ${skippedMinTurns}`);
  if (errored > 0) console.log(`  parse errors:      ${errored}`);
  if (!flags.dryRun && imported > 0) {
    console.log();
    console.log(`Run 'bun run brain queue' to see the imported entries.`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

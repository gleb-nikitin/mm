// Live filesystem probe for active Claude/Codex/Gemini sessions.
//
// Complement to getActiveAgents() which reads the DB-backed import_state
// table. Use live-probe when import cadence is too slow for the consumer
// (e.g. ac's watchdog gate). Latency target: <50ms for ~10-20 candidates.
//
// Scope note: parses only last-turn metadata per session. Full-session
// ingestion lives in scripts/import-{claude,codex,gemini}.ts — different
// goal, different parser depth. Intentionally not sharing helpers while
// both sides stabilize; consolidation is a follow-up.

import type { ActiveAgentRow } from './core';
import { resolveParticipantIds } from './core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LiveProbeOptions {
  maxAgeSeconds?: number;
  project?: string;
  claudeProjectsDir?: string;
  codexSessionsDir?: string;
  geminiSessionsDir?: string;
}

interface SessionSummary {
  provider: 'claude' | 'codex' | 'gemini';
  external_id: string;
  project: string;
  cwd: string | null;
  model: string | null;
  last_user_snippet: string | null;
  seconds_ago: number;
  min_turns_ok: boolean;
}

function projectSlugFromCwd(cwd: string | null): string {
  if (!cwd) return 'unknown';
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function secondsAgoFromMs(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
}

function extractClaudeContentText(raw: any): string {
  if (typeof raw === 'string') return raw.trim();
  if (!Array.isArray(raw)) return '';
  const parts: string[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text.trim());
    }
  }
  return parts.join(' ').trim();
}

function probeClaude(dir: string, maxAgeSeconds: number): SessionSummary[] {
  if (!fs.existsSync(dir)) return [];
  const cutoffMs = Date.now() - maxAgeSeconds * 1000;
  const out: SessionSummary[] = [];

  let projectDirs: string[];
  try {
    projectDirs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return out;
  }

  for (const proj of projectDirs) {
    const projDir = path.join(dir, proj);
    let entries: string[];
    try {
      entries = fs.readdirSync(projDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = path.join(projDir, entry);
      let st: fs.Stats;
      try {
        st = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoffMs) continue;

      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      type Sess = {
        id: string;
        cwd: string | null;
        model: string | null;
        userTurns: number;
        latestTs: string;
        latestText: string | null;
      };
      const bySession = new Map<string, Sess>();

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let rec: any;
        try {
          rec = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const sid = rec.sessionId;
        if (typeof sid !== 'string' || !sid) continue;

        let s = bySession.get(sid);
        if (!s) {
          s = { id: sid, cwd: null, model: null, userTurns: 0, latestTs: '', latestText: null };
          bySession.set(sid, s);
        }
        if (rec.cwd && !s.cwd) s.cwd = rec.cwd;

        const msg = rec.message || {};
        const ts = typeof rec.timestamp === 'string' ? rec.timestamp : '';

        if (rec.type === 'user') {
          const text = extractClaudeContentText(msg.content);
          if (text) {
            s.userTurns++;
            if (!s.latestTs || ts >= s.latestTs) {
              s.latestTs = ts;
              s.latestText = text.slice(0, 200);
            }
          }
        } else if (rec.type === 'assistant') {
          if (typeof msg.model === 'string' && msg.model && !s.model) s.model = msg.model;
          const text = extractClaudeContentText(msg.content);
          if (text && (!s.latestTs || ts >= s.latestTs)) {
            s.latestTs = ts;
            s.latestText = text.slice(0, 200);
          }
        }
      }

      for (const s of bySession.values()) {
        out.push({
          provider: 'claude',
          external_id: s.id,
          project: projectSlugFromCwd(s.cwd),
          cwd: s.cwd,
          model: s.model,
          last_user_snippet: s.latestText,
          seconds_ago: secondsAgoFromMs(st.mtimeMs),
          min_turns_ok: s.userTurns >= 2,
        });
      }
    }
  }
  return out;
}

function extractCodexAssistantText(content: any): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === 'object' && item.type === 'output_text' && typeof item.text === 'string') {
      parts.push(item.text.trim());
    }
  }
  return parts.join(' ').trim();
}

function probeCodex(dir: string, maxAgeSeconds: number): SessionSummary[] {
  if (!fs.existsSync(dir)) return [];
  const cutoffMs = Date.now() - maxAgeSeconds * 1000;
  const files: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) files.push(full);
    }
  }

  const out: SessionSummary[] = [];
  for (const filePath of files) {
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (st.mtimeMs < cutoffMs) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    let sessionId: string | null = null;
    let cwd: string | null = null;
    let model: string | null = null;
    let userTurns = 0;
    let latestTs = '';
    let latestText: string | null = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: any;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const recordType = rec?.type;
      const ts = typeof rec?.timestamp === 'string' ? rec.timestamp : '';
      const payload = rec?.payload || {};

      if (recordType === 'session_meta') {
        if (typeof payload.id === 'string' && payload.id) sessionId = payload.id;
        if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
        if (typeof payload.model === 'string' && payload.model) model = payload.model;
        continue;
      }

      if (recordType === 'event_msg' && payload.type === 'user_message') {
        const text = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (text) {
          userTurns++;
          if (!latestTs || ts >= latestTs) {
            latestTs = ts;
            latestText = text.slice(0, 200);
          }
        }
        continue;
      }

      if (recordType === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
        const text = extractCodexAssistantText(payload.content);
        if (text && (!latestTs || ts >= latestTs)) {
          latestTs = ts;
          latestText = text.slice(0, 200);
        }
      }
    }

    if (!sessionId) continue;
    out.push({
      provider: 'codex',
      external_id: sessionId,
      project: projectSlugFromCwd(cwd),
      cwd,
      model,
      last_user_snippet: latestText,
      seconds_ago: secondsAgoFromMs(st.mtimeMs),
      min_turns_ok: userTurns >= 2,
    });
  }
  return out;
}

function extractGeminiUserText(content: any): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === 'object') {
      const t = (item as any).text;
      if (typeof t === 'string' && t.trim()) parts.push(t.trim());
    }
  }
  return parts.join('\n\n');
}

function probeGemini(dir: string, maxAgeSeconds: number): SessionSummary[] {
  if (!fs.existsSync(dir)) return [];
  const cutoffMs = Date.now() - maxAgeSeconds * 1000;
  const files: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /^session-.*\.json$/.test(e.name)) files.push(full);
    }
  }

  const out: SessionSummary[] = [];
  for (const filePath of files) {
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (st.mtimeMs < cutoffMs) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const sessionId = parsed?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) continue;

    const chatsDir = path.dirname(filePath);
    const project = path.basename(path.dirname(chatsDir)) || 'unknown';

    let model: string | null = null;
    let userTurns = 0;
    let latestTs = '';
    let latestText: string | null = null;

    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    for (const m of messages) {
      const mType = m?.type;
      const ts = typeof m?.timestamp === 'string'
        ? m.timestamp
        : typeof parsed?.lastUpdated === 'string'
          ? parsed.lastUpdated
          : typeof parsed?.startTime === 'string'
            ? parsed.startTime
            : '';

      if (mType === 'user') {
        const text = extractGeminiUserText(m.content);
        if (text) {
          userTurns++;
          if (!latestTs || ts >= latestTs) {
            latestTs = ts;
            latestText = text.slice(0, 200);
          }
        }
        continue;
      }

      if (mType === 'gemini') {
        if (!model && typeof m.model === 'string' && m.model.trim()) model = m.model.trim();
        const text = typeof m.content === 'string' ? m.content.trim() : '';
        if (text && (!latestTs || ts >= latestTs)) {
          latestTs = ts;
          latestText = text.slice(0, 200);
        }
      }
    }

    out.push({
      provider: 'gemini',
      external_id: sessionId,
      project,
      cwd: null,
      model,
      last_user_snippet: latestText,
      seconds_ago: secondsAgoFromMs(st.mtimeMs),
      min_turns_ok: userTurns >= 2,
    });
  }
  return out;
}

export function getActiveAgentsLive(opts: LiveProbeOptions = {}): ActiveAgentRow[] {
  const maxAgeSeconds = opts.maxAgeSeconds ?? 300;
  const claudeDir = opts.claudeProjectsDir
    ?? process.env.MT_CLAUDE_PROJECTS_DIR
    ?? path.join(os.homedir(), '.claude', 'projects');
  const codexDir = opts.codexSessionsDir
    ?? process.env.MT_CODEX_SESSIONS_DIR
    ?? path.join(os.homedir(), '.codex', 'sessions');
  const geminiDir = opts.geminiSessionsDir
    ?? process.env.MT_GEMINI_SESSIONS_DIR
    ?? path.join(os.homedir(), '.gemini', 'tmp');

  const summaries: SessionSummary[] = [
    ...probeClaude(claudeDir, maxAgeSeconds),
    ...probeCodex(codexDir, maxAgeSeconds),
    ...probeGemini(geminiDir, maxAgeSeconds),
  ];

  const filtered = summaries.filter(
    s =>
      s.project !== 'unknown' &&
      (s.min_turns_ok || s.last_user_snippet !== null) &&
      (!opts.project || s.project === opts.project)
  );

  filtered.sort((a, b) => a.seconds_ago - b.seconds_ago);

  const externalIds = filtered.map(s => s.external_id);
  const participantMap = resolveParticipantIds(externalIds);

  return filtered.map(s => ({
    participant_id: participantMap.get(s.external_id) ?? null,
    provider: s.provider,
    project: s.project,
    seconds_ago: s.seconds_ago,
    model: s.model,
    last_user_snippet: s.last_user_snippet,
    external_id: s.external_id,
    cwd: s.cwd,
  }));
}

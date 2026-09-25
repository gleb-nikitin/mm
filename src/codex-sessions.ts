import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type CodexSessionCandidate = {
  sessionId: string;
  sourcePath: string;
  rootPriority: number;
  mtimeMs: number;
};

export function readCodexSessionId(sourcePath: string): string | null {
  const fd = fs.openSync(sourcePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    for (const line of buffer.toString('utf8', 0, bytesRead).split('\n')) {
      if (!line.trim()) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        record?.type === 'session_meta'
        && typeof record?.payload?.id === 'string'
        && record.payload.id
      ) return record.payload.id;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

export function identifyCodexSessionId(sourcePath: string): string | null {
  const filenameMatch = path.basename(sourcePath).match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
  );
  if (filenameMatch) return filenameMatch[1];
  return readCodexSessionId(sourcePath);
}

function expandLeadingHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveCodexSessionRoots(explicitDir?: string | null): string[] {
  const configured = explicitDir !== undefined && explicitDir !== null
    ? [explicitDir]
    : process.env.MT_CODEX_SESSIONS_DIR !== undefined
      ? process.env.MT_CODEX_SESSIONS_DIR.split(':')
      : [path.join(os.homedir(), '.codex', 'sessions')];

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const raw of configured) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(expandLeadingHome(trimmed));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push(resolved);
  }
  return roots;
}

export function codexRootPriorityForPath(sourcePath: string, roots: string[]): number {
  const resolved = path.resolve(sourcePath);
  for (let i = 0; i < roots.length; i++) {
    const relative = path.relative(roots[i], resolved);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return i;
  }
  return Number.POSITIVE_INFINITY;
}

export function selectCodexSessionWinners<T extends CodexSessionCandidate>(candidates: T[]): {
  winners: T[];
  losers: T[];
} {
  const bySession = new Map<string, T[]>();
  for (const candidate of candidates) {
    const group = bySession.get(candidate.sessionId) ?? [];
    group.push(candidate);
    bySession.set(candidate.sessionId, group);
  }

  const winners: T[] = [];
  const losers: T[] = [];
  for (const group of bySession.values()) {
    group.sort((a, b) =>
      a.rootPriority - b.rootPriority
      || b.mtimeMs - a.mtimeMs
      || a.sourcePath.localeCompare(b.sourcePath)
    );
    // Root order intentionally outranks freshness: a resumed fallback copy stays shadowed for deterministic provenance.
    winners.push(group[0]);
    losers.push(...group.slice(1));
  }
  winners.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return { winners, losers };
}

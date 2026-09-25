import { afterEach, describe, expect, test } from 'bun:test';
import * as os from 'os';
import * as path from 'path';
import {
  resolveCodexSessionRoots,
  selectCodexSessionWinners,
} from '../src/codex-sessions.ts';

const savedCodexSessionsDir = process.env.MT_CODEX_SESSIONS_DIR;

afterEach(() => {
  if (savedCodexSessionsDir === undefined) delete process.env.MT_CODEX_SESSIONS_DIR;
  else process.env.MT_CODEX_SESSIONS_DIR = savedCodexSessionsDir;
});

describe('Codex session roots', () => {
  test('parses ordered env roots and expands a leading home segment', () => {
    process.env.MT_CODEX_SESSIONS_DIR = '~/aurora-codex:/tmp/default-codex';
    expect(resolveCodexSessionRoots()).toEqual([
      path.join(os.homedir(), 'aurora-codex'),
      '/tmp/default-codex',
    ]);
  });

  test('explicit directory replaces the environment list', () => {
    process.env.MT_CODEX_SESSIONS_DIR = '/tmp/ignored-primary:/tmp/ignored-fallback';
    expect(resolveCodexSessionRoots('/tmp/explicit')).toEqual(['/tmp/explicit']);
  });

  test('root priority wins even when the fallback is newer', () => {
    const primary = {
      sessionId: 'same-session',
      sourcePath: '/primary/rollout.jsonl',
      rootPriority: 0,
      mtimeMs: 1,
      marker: 'primary',
    };
    const fallback = {
      sessionId: 'same-session',
      sourcePath: '/fallback/rollout.jsonl',
      rootPriority: 1,
      mtimeMs: 999,
      marker: 'fallback',
    };
    const selected = selectCodexSessionWinners([fallback, primary]);
    expect(selected.winners.map(row => row.marker)).toEqual(['primary']);
    expect(selected.losers.map(row => row.marker)).toEqual(['fallback']);
  });
});

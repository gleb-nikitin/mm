import { afterEach, describe, expect, test } from 'bun:test';
import * as os from 'os';
import * as path from 'path';
import {
  codexFirstTurnBoundary,
  isCodexInjectedUserContext,
  resolveCodexSessionRoots,
  selectCodexSessionWinners,
} from '../src/codex-sessions.ts';

const savedCodexSessionsDir = process.env.MT_CODEX_SESSIONS_DIR;

afterEach(() => {
  if (savedCodexSessionsDir === undefined) delete process.env.MT_CODEX_SESSIONS_DIR;
  else process.env.MT_CODEX_SESSIONS_DIR = savedCodexSessionsDir;
});

describe('Codex session roots', () => {
  test('recognizes unannotated host context records without matching normal prompts', () => {
    expect(isCodexInjectedUserContext('# AGENTS.md instructions for /tmp/project')).toBe(true);
    expect(isCodexInjectedUserContext('<environment_context>\n  <cwd>/tmp</cwd>')).toBe(true);
    expect(isCodexInjectedUserContext('<recommended_plugins>\nplugin list')).toBe(true);
    expect(isCodexInjectedUserContext('Inspect AGENTS.md and summarize it')).toBe(false);
    expect(isCodexInjectedUserContext('unknown host bootstrap', true)).toBe(true);
    expect(isCodexInjectedUserContext('# Context from my IDE setup:\n## My request for Codex:\nfix it', true)).toBe(false);
    expect(codexFirstTurnBoundary(2, 3, 6)).toBe(3);
    expect(codexFirstTurnBoundary(5, 1, 4)).toBe(4);
  });

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

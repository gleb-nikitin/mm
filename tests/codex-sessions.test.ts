import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  codexFirstTurnBoundary,
  identifyCodexSessionId,
  isCodexInjectedUserContext,
  readCodexSessionId,
  resolveCodexSessionRoots,
  selectCodexCurrentUserRecords,
  selectCodexSessionWinners,
} from '../src/codex-sessions.ts';

const savedCodexSessionsDir = process.env.MT_CODEX_SESSIONS_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (savedCodexSessionsDir === undefined) delete process.env.MT_CODEX_SESSIONS_DIR;
  else process.env.MT_CODEX_SESSIONS_DIR = savedCodexSessionsDir;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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

  test('pairs only one adjacent normalized duplicate and preserves a real repeat', () => {
    const legacy = [{ timestamp: '2026-09-25T00:00:00.020Z', text: 'repeat  prompt', recordIndex: 1 }];
    const selected = selectCodexCurrentUserRecords(legacy, [
      {
        timestamp: '2026-09-25T00:00:00.000Z',
        text: 'repeat\nprompt',
        recordIndex: 0,
        explicitlyUserAuthored: false,
      },
      {
        timestamp: '2026-09-25T00:00:01.000Z',
        text: 'repeat prompt',
        recordIndex: 2,
        explicitlyUserAuthored: false,
      },
    ], -1);

    expect(selected.map(user => user.recordIndex)).toEqual([2]);
    expect(legacy.length + selected.length).toBe(2);

    const exactThenRepeat = selectCodexCurrentUserRecords(
      [{ timestamp: '2026-09-25T00:00:00.000Z', text: 'repeat prompt', recordIndex: 1 }],
      [
        {
          timestamp: '2026-09-25T00:00:00.000Z',
          text: 'repeat prompt',
          recordIndex: 0,
          explicitlyUserAuthored: false,
        },
        {
          timestamp: '2026-09-25T00:00:01.000Z',
          text: 'repeat prompt',
          recordIndex: 2,
          explicitlyUserAuthored: false,
        },
      ],
      -1,
    );
    expect(exactThenRepeat.map(user => user.recordIndex)).toEqual([2]);
    expect(legacy.length + exactThenRepeat.length).toBe(2);

    expect(selectCodexCurrentUserRecords(
      [{ timestamp: '2026-09-25T00:00:00.020Z', text: 'legacy first', recordIndex: 0 }],
      [{
        timestamp: '2026-09-25T00:00:00.000Z',
        text: 'legacy\nfirst',
        recordIndex: 1,
        explicitlyUserAuthored: false,
      }],
      -1,
    )).toHaveLength(0);
  });

  test('reads a session id from a first metadata line larger than 64 KiB', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-codex-id-'));
    tempDirs.push(dir);
    const sessionId = '01a09c2f-7e4a-7962-8765-3915441b7680';
    const file = path.join(dir, `rollout-${sessionId}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({
      type: 'session_meta',
      payload: { id: sessionId, instructions: 'x'.repeat(80 * 1024) },
    }) + '\n');

    expect(readCodexSessionId(file)).toBe(sessionId);
    expect(identifyCodexSessionId(file)).toBe(sessionId);
  });

  test('falls back to the filename id and warns only when readable metadata disagrees', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-codex-id-'));
    tempDirs.push(dir);
    const filenameId = '01a095ee-d2ad-7283-8398-90b17447b415';
    const metadataId = '01a09c2f-7e4a-7962-8765-3915441b7680';
    const fallbackFile = path.join(dir, `rollout-${filenameId}.jsonl`);
    fs.writeFileSync(fallbackFile, '{malformed session metadata}\n');
    expect(identifyCodexSessionId(fallbackFile)).toBe(filenameId);

    const mismatchFile = path.join(dir, `fork-${filenameId}.jsonl`);
    fs.writeFileSync(mismatchFile, JSON.stringify({
      type: 'session_meta',
      payload: { id: metadataId },
    }) + '\n');
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(identifyCodexSessionId(mismatchFile)).toBe(metadataId);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]?.[0]).toContain('session ID mismatch');
    } finally {
      warning.mockRestore();
    }
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

import { expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(import.meta.dir, '..');

test('watch launches importers with its own Bun binary when PATH has no bun', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-watch-'));
  const claudeDir = path.join(root, 'claude');
  const codexDir = path.join(root, 'codex');
  const missingCodexDir = path.join(root, 'missing-codex');
  const geminiDir = path.join(root, 'gemini');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(geminiDir, { recursive: true });

  const proc = Bun.spawn({
    cmd: [process.execPath, 'scripts/watch.ts'],
    cwd: REPO,
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin',
      MT_BRAIN_ROOT: root,
      MT_AC_DB_PATH: path.join(root, 'missing-ac.db'),
      MT_CLAUDE_PROJECTS_DIR: claudeDir,
      MT_CODEX_SESSIONS_DIR: `${missingCodexDir}:${codexDir}`,
      MT_GEMINI_SESSIONS_DIR: geminiDir,
      MM_WATCH_INTERVAL_MS: '50',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeout = setTimeout(() => proc.kill('SIGTERM'), 2_000);
  try {
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    await proc.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    expect(stdout).toContain('[watch] starting');
    expect(stdout).toContain('claude=ok/');
    expect(stdout).toContain('codex=ok/');
    expect(stdout).toContain('gemini=ok/');
    expect(stderr).not.toContain('Failed to spawn');
    expect(stderr.match(/Codex sessions dir unavailable:/g)).toHaveLength(1);
  } finally {
    clearTimeout(timeout);
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
      await proc.exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

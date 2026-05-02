// Loops the three importers every INTERVAL_MS. Designed to run under Aurora's
// process supervisor (declared as `process.mm-watch` in plugins/mm/processes.toml).
// Logs structured progress to stdout; supervisor captures into log.db.

import { spawn } from 'bun';

const INTERVAL_MS = Number(process.env.MM_WATCH_INTERVAL_MS ?? 1000);
let stopping = false;
let wakeSleep: (() => void) | null = null;

function stop(): void {
  stopping = true;
  wakeSleep?.();
}

process.on('SIGTERM', stop);
process.on('SIGINT',  stop);

async function run(script: string): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  const proc = spawn({
    cmd: ['bun', `scripts/${script}`, '--days', '1'],
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const code = await proc.exited;
  return { ok: code === 0, ms: Date.now() - start };
}

async function sleep(ms: number): Promise<void> {
  if (stopping) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      wakeSleep = null;
      resolve();
    }, ms);
    wakeSleep = () => {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    };
  });
}

console.log(`[watch] starting; interval=${INTERVAL_MS}ms`);

while (!stopping) {
  const ts = new Date().toISOString();
  const claude = await run('import-claude.ts');
  if (stopping) break;
  const codex = await run('import-codex.ts');
  if (stopping) break;
  const gemini = await run('import-gemini.ts');
  console.log(`[watch] ${ts} claude=${claude.ok ? 'ok' : 'fail'}/${claude.ms}ms codex=${codex.ok ? 'ok' : 'fail'}/${codex.ms}ms gemini=${gemini.ok ? 'ok' : 'fail'}/${gemini.ms}ms`);
  if (stopping) break;
  await sleep(INTERVAL_MS);
}

console.log('[watch] stopping cleanly');

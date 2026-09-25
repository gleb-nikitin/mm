import { describe, expect, test } from 'bun:test';
import * as path from 'path';

const REPO = path.resolve(import.meta.dir, '..');

describe('plugin process manifest', () => {
  test('injects install-local ac DB and ordered Codex roots into both processes', async () => {
    const manifest = Bun.TOML.parse(
      await Bun.file(path.join(REPO, 'processes.toml')).text(),
    ) as any;

    const codexRoots = '$AURORA_DATA/data/codex-home/sessions:~/.codex/sessions';
    expect(manifest.process.mm.env.MT_AC_DB_PATH).toBe('$AURORA_DATA/data/msg.db');
    expect(manifest.process.mm.env.MT_CODEX_SESSIONS_DIR).toBe(codexRoots);
    expect(manifest.process['mm-watch'].env.MT_AC_DB_PATH).toBe('$AURORA_DATA/data/msg.db');
    expect(manifest.process['mm-watch'].env.MT_CODEX_SESSIONS_DIR).toBe(codexRoots);
  });

  test('operator importer entrypoints declare MT_AC_DB_PATH before importing', async () => {
    const declaration = 'export MT_AC_DB_PATH="${MT_AC_DB_PATH:-$HOME/Library/Application Support/com.aurora.core/data/msg.db}"';
    for (const file of ['distill-new.command', 'process-new.command', 'watch-agents.command']) {
      const contents = await Bun.file(path.join(REPO, file)).text();
      const declarationOffset = contents.indexOf(declaration);
      const firstImporterOffset = contents.indexOf('bun scripts/import-');
      expect(declarationOffset, file).toBeGreaterThan(-1);
      expect(firstImporterOffset, file).toBeGreaterThan(declarationOffset);
    }
  });
});

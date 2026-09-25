import { describe, expect, test } from 'bun:test';
import * as path from 'path';

const REPO = path.resolve(import.meta.dir, '..');

describe('plugin process manifest', () => {
  test('injects the install-local ac DB path into API and watcher processes', async () => {
    const manifest = Bun.TOML.parse(
      await Bun.file(path.join(REPO, 'processes.toml')).text(),
    ) as any;

    expect(manifest.process.mm.env.MT_AC_DB_PATH).toBe('$AURORA_DATA/msg.db');
    expect(manifest.process['mm-watch'].env.MT_AC_DB_PATH).toBe('$AURORA_DATA/msg.db');
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

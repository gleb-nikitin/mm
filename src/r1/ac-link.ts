import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SessionLink } from './types.ts';

export interface AcDbPathOpts {
  envValue?: string;
  prodPath?: string;
  workspacePath?: string;
}

export function resolveAcDbPath(opts: AcDbPathOpts = {}): string {
  const envValue = opts.envValue ?? process.env.MT_AC_DB_PATH;
  if (envValue) return envValue;
  const prodPath = opts.prodPath
    ?? path.join(os.homedir(), 'Library/Application Support/com.aurora.core/data/msg.db');
  if (fs.existsSync(prodPath)) return prodPath;
  return opts.workspacePath ?? '/Users/glebnikitin/work/code/ac/data/msg.db';
}

export type SessionLinkResolution = {
  links: Map<string, SessionLink>;
  acDbAvailable: boolean;
};

export function resolveSessionLinks(sessionIds: string[]): SessionLinkResolution {
  const links = new Map<string, SessionLink>();
  if (sessionIds.length === 0) return { links, acDbAvailable: true };

  const acDbPath = resolveAcDbPath();
  if (!fs.existsSync(acDbPath)) return { links, acDbAvailable: false };

  let acDb: Database | null = null;
  try {
    acDb = new Database(acDbPath, { readonly: true });
    acDb.exec('PRAGMA query_only = ON;');
    acDb.exec('PRAGMA busy_timeout = 5000;');
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = acDb.prepare(
      `SELECT
         s.id AS session_id,
         s.participant_id AS participant_id,
         p.project AS project,
         p.role AS role
       FROM llm_sessions s
       LEFT JOIN participants p ON p.id = s.participant_id
       WHERE s.id IN (${placeholders})`
    ).all(...sessionIds) as Array<{
      session_id: string;
      participant_id: string | null;
      project: string | null;
      role: string | null;
    }>;

    for (const row of rows) {
      if (!row.participant_id) continue;
      const projectRole = row.project && row.role ? `${row.project}/${row.role}` : null;
      links.set(row.session_id, {
        participant_id: row.participant_id,
        project: row.project,
        role: row.role,
        project_role: projectRole,
      });
    }
    return { links, acDbAvailable: true };
  } catch {
    return { links, acDbAvailable: false };
  } finally {
    if (acDb) {
      try { acDb.close(); } catch {}
    }
  }
}

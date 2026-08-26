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
  return opts.workspacePath ?? path.join(os.homedir(), 'work/code/ac/data/msg.db');
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
    const queryParams = [...sessionIds, ...sessionIds];
    const rows = acDb.prepare(
      `SELECT session_id, participant_id, project, role, kind FROM (
         SELECT
           p.active_session_id AS session_id,
           p.id AS participant_id,
           p.project,
           p.role,
           'active' AS kind
         FROM participants p
         WHERE p.active_session_id IN (${placeholders})
         UNION ALL
         SELECT
           v.old_session_id AS session_id,
           v.participant_id,
           p.project,
           p.role,
           'retired' AS kind
         FROM valhalla_sessions v
         JOIN participants p ON p.id = v.participant_id
         WHERE v.old_session_id IN (${placeholders})
       )`
    ).all(...queryParams) as Array<{
      session_id: string;
      participant_id: string | null;
      project: string | null;
      role: string | null;
      kind: 'active' | 'retired';
    }>;

    for (const row of rows) {
      if (!row.participant_id) continue;
      const existing = links.get(row.session_id);
      if (existing?.kind === 'active' && row.kind === 'retired') continue;
      const projectRole = row.project && row.role ? `${row.project}/${row.role}` : null;
      links.set(row.session_id, {
        kind: row.kind,
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

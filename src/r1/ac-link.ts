import { Database } from 'bun:sqlite';
import {
  acDbOrphanReason,
  acDbIsUsable,
  acDbUnreadable,
  reportAcDbStatus,
  resolveAcDbPath,
  type AcDbStatus,
} from '../ac-db.ts';
import type { SessionLink } from './types.ts';

export type SessionLinkResolution = {
  links: Map<string, SessionLink>;
  acDbAvailable: boolean;
  acDbStatus: AcDbStatus;
  acDbFailureReason: string | null;
};

export function resolveSessionLinks(sessionIds: string[]): SessionLinkResolution {
  const links = new Map<string, SessionLink>();
  const pathStatus = resolveAcDbPath();
  if (!acDbIsUsable(pathStatus) || !pathStatus.path) {
    return {
      links,
      acDbAvailable: false,
      acDbStatus: pathStatus,
      acDbFailureReason: acDbOrphanReason(pathStatus),
    };
  }
  if (sessionIds.length === 0) {
    return {
      links,
      acDbAvailable: true,
      acDbStatus: pathStatus,
      acDbFailureReason: null,
    };
  }

  let acDb: Database | null = null;
  try {
    acDb = new Database(pathStatus.path, { readonly: true });
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
    return { links, acDbAvailable: true, acDbStatus: pathStatus, acDbFailureReason: null };
  } catch (error) {
    const acDbStatus = acDbUnreadable(pathStatus, error);
    reportAcDbStatus(acDbStatus);
    return {
      links,
      acDbAvailable: false,
      acDbStatus,
      acDbFailureReason: acDbOrphanReason(acDbStatus),
    };
  } finally {
    if (acDb) {
      try { acDb.close(); } catch {}
    }
  }
}

import { db } from '../core.ts';
import { resolveSessionLinks } from './ac-link.ts';
import { recordMessageLink } from './message-link.ts';
import type { SessionIndexRow, SessionLink, SessionObservation, Vendor } from './types.ts';

export type ActiveSessionFilter = {
  project?: string | null;
  role?: string | null;
  limit?: number;
};

function runImmediateTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function stateForObservation(observation: SessionObservation, link: SessionLink | null, acDbAvailable: boolean) {
  if (link) {
    return {
      state: observation.state ?? 'working',
      orphan_reason: observation.state === 'orphan' ? observation.orphan_reason ?? 'orphan' : null,
    };
  }
  return {
    state: 'orphan' as const,
    orphan_reason: observation.orphan_reason ?? (acDbAvailable ? 'participant_not_found' : 'ac_db_unavailable'),
  };
}

export function findRawEventIdByExternalId(externalId: string): number | null {
  const row = db.prepare(`SELECT id FROM raw_events WHERE external_id = ?`).get(externalId) as { id: number } | undefined;
  return row?.id ?? null;
}

export function upsertSessionObservation(observation: SessionObservation, link: SessionLink | null = null, acDbAvailable = true): void {
  const state = stateForObservation(observation, link, acDbAvailable);
  db.prepare(
    `INSERT INTO session_index
       (vendor, session_id, source_path, raw_event_id, participant_id,
        project, role, project_role, cwd, model, started_at, last_activity_at,
        last_imported_at, last_mtime, last_log_line, state, orphan_reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
     ON CONFLICT(vendor, session_id) DO UPDATE SET
       source_path = excluded.source_path,
       raw_event_id = COALESCE(excluded.raw_event_id, session_index.raw_event_id),
       participant_id = excluded.participant_id,
       project = excluded.project,
       role = excluded.role,
       project_role = excluded.project_role,
       cwd = excluded.cwd,
       model = excluded.model,
       started_at = COALESCE(excluded.started_at, session_index.started_at),
       last_activity_at = excluded.last_activity_at,
       last_imported_at = excluded.last_imported_at,
       last_mtime = excluded.last_mtime,
       last_log_line = excluded.last_log_line,
       state = excluded.state,
       orphan_reason = excluded.orphan_reason,
       metadata = excluded.metadata`
  ).run(
    observation.vendor,
    observation.session_id,
    observation.source_path,
    observation.raw_event_id,
    link?.participant_id ?? null,
    link?.project ?? observation.project,
    link?.role ?? null,
    link?.project_role ?? null,
    observation.cwd,
    observation.model,
    observation.started_at,
    observation.last_activity_at,
    observation.last_mtime,
    observation.last_log_line,
    state.state,
    state.orphan_reason,
    observation.metadata ?? null,
  );
}

export function linkSession(observation: SessionObservation, link: SessionLink): void {
  upsertSessionObservation(observation, link, true);
}

export function recordSessionObservation(observation: SessionObservation, messageText?: string): void {
  const { links, acDbAvailable } = resolveSessionLinks([observation.session_id]);
  const link = links.get(observation.session_id) ?? null;
  runImmediateTransaction(() => {
    upsertSessionObservation(observation, link, acDbAvailable);
    if (messageText) {
      recordMessageLink({
        vendor: observation.vendor,
        session_id: observation.session_id,
        participant_id: link?.participant_id ?? null,
        source_path: observation.source_path,
        text: messageText,
      });
    }
  });
}

export function getSessionByVendorAndId(vendor: Vendor, sessionId: string): SessionIndexRow | null {
  const row = db.prepare(
    `SELECT * FROM session_index WHERE vendor = ? AND session_id = ?`
  ).get(vendor, sessionId) as SessionIndexRow | undefined;
  return row ?? null;
}

export function listActiveSessions(filter: ActiveSessionFilter = {}): SessionIndexRow[] {
  const clauses = [`state IN ('working', 'idle', 'wedged')`];
  const params: any[] = [];
  if (filter.project) {
    clauses.push('project = ?');
    params.push(filter.project);
  }
  if (filter.role) {
    clauses.push('role = ?');
    params.push(filter.role);
  }
  params.push(filter.limit ?? 50);
  return db.prepare(
    `SELECT * FROM session_index
     WHERE ${clauses.join(' AND ')}
     ORDER BY last_activity_at DESC
     LIMIT ?`
  ).all(...params) as SessionIndexRow[];
}

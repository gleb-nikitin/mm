import { Database } from 'bun:sqlite';
import * as fs from 'fs';

export type AcDbSource = 'mt_ac_db_path';
export type AcDbStatusCode = 'available' | 'missing' | 'unresolved' | 'unreadable';

export type AcDbStatus = {
  status: AcDbStatusCode;
  source: AcDbSource | null;
  path: string | null;
  message: string | null;
};

export interface AcDbPathOpts {
  env?: Record<string, string | undefined>;
  existsSync?: (candidate: string) => boolean;
}

/**
 * Resolve ac's msg.db once for every mm surface.
 *
 * MT_AC_DB_PATH is supplied to both managed processes by processes.toml. The
 * supervisor expands $AURORA_DATA inside manifest values but never exports an
 * AURORA_DATA child variable, so adding that as a fallback would be dead code.
 * Standalone callers must set MT_AC_DB_PATH explicitly.
 */
export function resolveAcDbPath(opts: AcDbPathOpts = {}): AcDbStatus {
  return inspectAcDb(resolveAcDbCandidate(opts));
}

function resolveAcDbCandidate(opts: AcDbPathOpts): AcDbStatus {
  const env = opts.env ?? process.env;
  const existsSync = opts.existsSync ?? fs.existsSync;
  const override = env.MT_AC_DB_PATH?.trim();
  if (override) return statusForCandidate(override, 'mt_ac_db_path', existsSync);

  return {
    status: 'unresolved',
    source: null,
    path: null,
    message: 'Aurora database is not configured; set MT_AC_DB_PATH',
  };
}

function statusForCandidate(
  candidate: string,
  source: AcDbSource,
  existsSync: (candidate: string) => boolean,
): AcDbStatus {
  if (existsSync(candidate)) {
    return { status: 'available', source, path: candidate, message: null };
  }
  return {
    status: 'missing',
    source,
    path: candidate,
    message: `Aurora database path from MT_AC_DB_PATH does not exist: ${candidate}`,
  };
}

export function acDbUnreadable(status: AcDbStatus, error: unknown): AcDbStatus {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    status: 'unreadable',
    source: status.source,
    path: status.path,
    message: `Aurora database could not be read${status.path ? ` at ${status.path}` : ''}: ${detail}`,
  };
}

/** Validate that the configured file is readable and has the ac link schema. */
function inspectAcDb(pathStatus: AcDbStatus): AcDbStatus {
  if (!acDbIsUsable(pathStatus) || !pathStatus.path) {
    reportAcDbStatus(pathStatus);
    return pathStatus;
  }

  let acDb: Database | null = null;
  try {
    acDb = new Database(pathStatus.path, { readonly: true });
    acDb.exec('PRAGMA query_only = ON;');
    acDb.exec('PRAGMA busy_timeout = 5000;');
    acDb.prepare(
      'SELECT id, project, role, active_session_id FROM participants LIMIT 0'
    ).all();
    acDb.prepare(
      'SELECT participant_id, old_session_id FROM valhalla_sessions LIMIT 0'
    ).all();
    reportAcDbStatus(pathStatus);
    return pathStatus;
  } catch (error) {
    const status = acDbUnreadable(pathStatus, error);
    reportAcDbStatus(status);
    return status;
  } finally {
    if (acDb) {
      try { acDb.close(); } catch {}
    }
  }
}

export function acDbOrphanReason(status: AcDbStatus): string | null {
  if (acDbIsUsable(status)) return null;
  if (status.status === 'missing') return 'ac_db_path_missing';
  if (status.status === 'unresolved') return 'ac_db_unconfigured';
  return 'ac_db_unreadable';
}

export function acDbIsUsable(status: AcDbStatus): boolean {
  return status.status === 'available';
}

let lastReportedFailure: string | null = null;

/** Emit one supervisor-visible line per distinct failure, without per-tick spam. */
export function reportAcDbStatus(
  status: AcDbStatus,
  write: (message: string) => void = console.error,
): void {
  if (status.status === 'available') {
    lastReportedFailure = null;
    return;
  }
  const key = `${status.status}\0${status.source ?? ''}\0${status.path ?? ''}\0${status.message ?? ''}`;
  if (key === lastReportedFailure) return;
  lastReportedFailure = key;
  write(`[mm] ac database ${status.status}: ${status.message ?? 'unknown failure'}`);
}

import { db } from '../core.ts';
import { eventTypeForStateChange } from './session-state.ts';
import type {
  SessionEvent,
  SessionEventRow,
  SessionEventType,
  SessionIndexRow,
  SessionLink,
  SessionObservation,
  SessionState,
} from './types.ts';

// SQLite is the durable event stream. The subscriber map covers same-process
// appends, while SSE handlers also run a 1s DB catch-up loop so streams receive
// rows written by standalone importer processes. Unsubscribe is called on abort
// and stream errors to avoid retaining dead controllers.

export const SESSION_EVENT_CATCHUP_INTERVAL_MS = 1000;

type Subscriber = (event: SessionEventRow) => void;
type SessionEventInput = {
  event_type: SessionEventType;
  vendor: SessionObservation['vendor'];
  session_id: string;
  participant_id: string | null;
  project_role: string | null;
  timestamp: string;
  last_log_line: string | null;
  payload: Record<string, unknown>;
};

export type SessionEventFilter = {
  projects?: string[] | null;
  roles?: string[] | null;
};

const subscribers = new Map<string, Subscriber>();
let subscriberSeq = 0;

function rowToEvent(row: SessionEventRow): SessionEvent {
  return {
    ...row,
    payload: JSON.parse(row.payload),
  };
}

function notify(row: SessionEventRow): void {
  for (const callback of subscribers.values()) {
    try {
      callback(row);
    } catch {
      // Dead subscribers are removed by their stream cleanup path.
    }
  }
}

export function subscribeSessionEvents(callback: Subscriber): () => void {
  const id = `sub-${Date.now()}-${subscriberSeq++}`;
  subscribers.set(id, callback);
  return () => {
    subscribers.delete(id);
  };
}

export function appendSessionEvent(input: SessionEventInput, options: { notify?: boolean } = {}): SessionEventRow {
  const result = db.prepare(
    `INSERT INTO session_events
       (event_type, vendor, session_id, participant_id, project_role, timestamp, last_log_line, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.event_type,
    input.vendor,
    input.session_id,
    input.participant_id,
    input.project_role,
    input.timestamp,
    input.last_log_line,
    JSON.stringify(input.payload),
  );
  const row = db.prepare(`SELECT * FROM session_events WHERE id = ?`).get(result.lastInsertRowid) as SessionEventRow;
  if (options.notify ?? true) notify(row);
  return row;
}

export function notifySessionEvent(row: SessionEventRow): void {
  notify(row);
}

function eventPayload(observation: SessionObservation, state: SessionState, previousState: SessionState | null): Record<string, unknown> {
  return {
    state,
    previous_state: previousState,
    source_path: observation.source_path,
    raw_event_id: observation.raw_event_id,
    orphan_reason: state === 'orphan' ? observation.orphan_reason ?? null : null,
  };
}

export function recordStateTransition(input: {
  previous: SessionIndexRow | null;
  observation: SessionObservation;
  link: SessionLink | null;
  state: SessionState;
  orphanReason: string | null;
}): SessionEventRow | null {
  const eventType = eventTypeForStateChange(input.previous?.state ?? null, input.state);
  if (!eventType) return null;
  return appendSessionEvent({
    event_type: eventType,
    vendor: input.observation.vendor,
    session_id: input.observation.session_id,
    participant_id: input.link?.participant_id ?? input.previous?.participant_id ?? null,
    project_role: input.link?.project_role ?? input.previous?.project_role ?? null,
    timestamp: input.observation.last_activity_at,
    last_log_line: input.observation.last_log_line,
    payload: {
      ...eventPayload(input.observation, input.state, input.previous?.state ?? null),
      orphan_reason: input.state === 'orphan' ? input.orphanReason : null,
    },
  }, { notify: false });
}

function addInClauses(filter: SessionEventFilter, clauses: string[], params: unknown[]): void {
  if (filter.projects && filter.projects.length > 0) {
    clauses.push(`si.project IN (${filter.projects.map(() => '?').join(',')})`);
    params.splice(params.length, 0, ...filter.projects);
  }
  if (filter.roles && filter.roles.length > 0) {
    clauses.push(`si.role IN (${filter.roles.map(() => '?').join(',')})`);
    params.splice(params.length, 0, ...filter.roles);
  }
}

export function replaySessionEvents(sinceId: number, filter: SessionEventFilter = {}): SessionEventRow[] {
  const clauses = ['se.id > ?'];
  const params: any[] = [sinceId];
  addInClauses(filter, clauses, params);
  return db.prepare(
    `SELECT se.*
     FROM session_events se
     JOIN session_index si ON si.vendor = se.vendor AND si.session_id = se.session_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY se.id ASC`
  ).all(...params) as SessionEventRow[];
}

export function matchesSessionEventFilter(row: SessionEventRow, filter: SessionEventFilter = {}): boolean {
  if ((!filter.projects || filter.projects.length === 0) && (!filter.roles || filter.roles.length === 0)) return true;
  const session = db.prepare(
    `SELECT project, role FROM session_index WHERE vendor = ? AND session_id = ?`
  ).get(row.vendor, row.session_id) as { project: string; role: string | null } | undefined;
  if (!session) return false;
  if (filter.projects && filter.projects.length > 0 && !filter.projects.includes(session.project)) return false;
  if (filter.roles && filter.roles.length > 0 && (!session.role || !filter.roles.includes(session.role))) return false;
  return true;
}

export function formatSseEvent(row: SessionEventRow): string {
  const event = rowToEvent(row);
  const data = {
    event_type: event.event_type,
    project_role: event.project_role,
    participant_id: event.participant_id,
    session_id: event.session_id,
    vendor: event.vendor,
    timestamp: event.timestamp,
    last_log_line: event.last_log_line,
    payload: event.payload,
  };
  return `id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(data)}\n\n`;
}

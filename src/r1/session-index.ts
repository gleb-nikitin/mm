import { db } from '../core.ts';
import { resolveSessionLinks } from './ac-link.ts';
import { recordMessageLink } from './message-link.ts';
import { priceUsage } from './pricing.ts';
import { recordStateTransition, notifySessionEvent } from './session-events.ts';
import { deriveSessionState } from './session-state.ts';
import {
  extractClaudeContextWindow,
  extractCodexContextWindow,
  extractGeminiContextWindow,
} from './token-usage.ts';
import type {
  SessionIndexRow,
  SessionLink,
  SessionMessageLink,
  SessionObservation,
  SessionState,
  SessionUsage,
  SessionUsageRow,
  SessionEventRow,
  TokenUsage,
  Vendor,
} from './types.ts';

export type ActiveSessionFilter = {
  projects?: string[] | null;
  roles?: string[] | null;
  states?: SessionState[] | null;
  limit?: number;
};

export type ParticipantUsageFilter = {
  participant_id?: string | null;
  since?: string | null;
  until?: string | null;
  vendor?: Vendor | null;
};

export type ParticipantUsageAggregateRow = {
  participant_id: string;
  vendor: Vendor;
  tokens: TokenUsage;
  cost_usd: number | null;
  unpriced_session_count: number;
  session_count: number;
};

export type SessionBrowserSort =
  | 'last_activity_at:asc'
  | 'last_activity_at:desc'
  | 'started_at:asc'
  | 'started_at:desc'
  | 'tokens:desc'
  | 'cost_usd:desc';

export type SessionBrowserFilter = {
  vendor?: Vendor | null;
  participant_id?: string | null;
  project?: string | null;
  state?: SessionState | null;
  since?: string | null;
  until?: string | null;
  q?: string | null;
  offset?: number;
  limit?: number;
  sort?: SessionBrowserSort;
};

export type SessionBrowserRow = SessionIndexRow & {
  tokens: number | null;
  cost_usd: number | null;
};

export type SessionBrowserPage = {
  sessions: SessionBrowserRow[];
  total: number;
  offset: number;
  limit: number;
};

export type RawSessionEventRow = {
  id: number;
  external_id: string;
  timestamp: string;
  title: string | null;
  content: string;
  metadata: string | null;
};

export type SessionStateRefreshResult = {
  ran: boolean;
  changed: number;
};

const configuredRefreshSeconds = Number(process.env.MT_R1_STATE_REFRESH_SECONDS ?? 30);
export const DEFAULT_SESSION_STATE_REFRESH_SECONDS = Number.isFinite(configuredRefreshSeconds) && configuredRefreshSeconds >= 0
  ? configuredRefreshSeconds
  : 30;

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

function stateForObservation(
  observation: SessionObservation,
  link: SessionLink | null,
  acDbFailureReason: string | null,
) {
  const state = deriveSessionState({
    linked: Boolean(link),
    completed: link?.kind === 'retired' || observation.state === 'completed',
    explicitState: observation.state ?? null,
    last_activity_at: observation.last_activity_at,
  });
  if (state !== 'orphan') return { state, orphan_reason: null };
  return {
    state: 'orphan' as const,
    orphan_reason: observation.orphan_reason ?? acDbFailureReason ?? 'participant_not_found',
  };
}

export function findRawEventIdByExternalId(externalId: string): number | null {
  const row = db.prepare(`SELECT id FROM raw_events WHERE external_id = ?`).get(externalId) as { id: number } | undefined;
  return row?.id ?? null;
}

export function upsertSessionObservation(
  observation: SessionObservation,
  link: SessionLink | null = null,
  acDbFailureReason: string | null = null,
  derivedState = stateForObservation(observation, link, acDbFailureReason),
): void {
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
    derivedState.state,
    derivedState.orphan_reason,
    observation.metadata ?? null,
  );
}

export function linkSession(observation: SessionObservation, link: SessionLink): void {
  upsertSessionObservation(observation, link);
}

export function recordSessionObservation(observation: SessionObservation, messageText?: string): void {
  const { links, acDbFailureReason } = resolveSessionLinks([observation.session_id]);
  const link = links.get(observation.session_id) ?? null;
  recordResolvedSessionObservation(observation, link, acDbFailureReason, messageText);
}

function recordResolvedSessionObservation(
  observation: SessionObservation,
  link: SessionLink | null,
  acDbFailureReason: string | null,
  messageText?: string,
  reconciledState?: ReturnType<typeof stateForObservation>,
): void {
  const events = runImmediateTransaction(() => {
    const previous = getSessionByVendorAndId(observation.vendor, observation.session_id);
    const derivedState = reconciledState ?? stateForObservation(observation, link, acDbFailureReason);
    upsertSessionObservation(observation, link, acDbFailureReason, derivedState);
    const event = recordStateTransition({
      previous,
      observation,
      link,
      state: derivedState.state,
      orphanReason: derivedState.orphan_reason,
    });
    if (messageText) {
      recordMessageLink({
        vendor: observation.vendor,
        session_id: observation.session_id,
        participant_id: link?.participant_id ?? null,
        source_path: observation.source_path,
        text: messageText,
      });
    }
    return event ? [event] : [];
  });
  for (const event of events as SessionEventRow[]) notifySessionEvent(event);
}

/**
 * Refresh age and Aurora link provenance without reparsing source files.
 * Importers call this for their vendor from the normal watcher cadence, so
 * rows outside the transcript --days window still observe later retirement.
 * An unavailable Aurora DB is not evidence that a link disappeared, so those
 * rows are left untouched until a later refresh can resolve authoritatively.
 */
export function refreshStoredSessionStates(
  vendor: Vendor,
  options: { nowMs?: number; intervalSeconds?: number } = {},
): SessionStateRefreshResult {
  const nowMs = options.nowMs ?? Date.now();
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_SESSION_STATE_REFRESH_SECONDS;
  const markerPath = `r1:session-state-refresh:${vendor}`;
  const claimed = runImmediateTransaction(() => {
    const marker = db.prepare(
      `SELECT last_mtime FROM import_state WHERE source_path = ?`
    ).get(markerPath) as { last_mtime: number } | undefined;
    if (marker && nowMs - marker.last_mtime < intervalSeconds * 1000) return false;
    db.prepare(
      `INSERT INTO import_state (source_path, last_mtime, last_imported_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(source_path) DO UPDATE SET
         last_mtime = excluded.last_mtime,
         last_imported_at = excluded.last_imported_at`
    ).run(markerPath, nowMs);
    return true;
  });
  if (!claimed) return { ran: false, changed: 0 };

  const rows = db.prepare(
    `SELECT * FROM session_index WHERE vendor = ? ORDER BY session_id`
  ).all(vendor) as SessionIndexRow[];
  if (rows.length === 0) return { ran: true, changed: 0 };

  const batchSize = 400;
  let refreshed = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const { links, acDbAvailable } = resolveSessionLinks(batch.map(row => row.session_id));
    if (!acDbAvailable) continue;

    for (const row of batch) {
      const link = links.get(row.session_id) ?? null;
      const observation: SessionObservation = {
        vendor: row.vendor,
        session_id: row.session_id,
        source_path: row.source_path,
        raw_event_id: row.raw_event_id,
        project: row.project,
        cwd: row.cwd,
        model: row.model,
        started_at: row.started_at,
        last_activity_at: row.last_activity_at,
        last_mtime: row.last_mtime,
        last_log_line: row.last_log_line,
        state: undefined,
        orphan_reason: row.orphan_reason === 'metadata_parse_error' ? row.orphan_reason : null,
        metadata: row.metadata,
      };
      // Reconciliation has no new transcript evidence. Preserve terminal
      // states whose evidence exists only in the stored row; a genuine new
      // importer observation may still reactivate them through the normal path.
      const derived = row.state === 'completed' || row.state === 'wedged'
        ? { state: row.state, orphan_reason: null }
        : stateForObservation(observation, link, null);
      const participantId = link?.participant_id ?? null;
      const project = link?.project ?? observation.project;
      const role = link?.role ?? null;
      const projectRole = link?.project_role ?? null;
      if (
        row.state === derived.state
        && row.orphan_reason === derived.orphan_reason
        && row.participant_id === participantId
        && row.project === project
        && row.role === role
        && row.project_role === projectRole
      ) continue;

      recordResolvedSessionObservation(
        observation,
        link,
        null,
        undefined,
        derived,
      );
      refreshed++;
    }
  }
  return { ran: true, changed: refreshed };
}

export function getSessionByVendorAndId(vendor: Vendor, sessionId: string): SessionIndexRow | null {
  const row = db.prepare(
    `SELECT * FROM session_index WHERE vendor = ? AND session_id = ?`
  ).get(vendor, sessionId) as SessionIndexRow | undefined;
  return row ?? null;
}

export function listSessionsBySessionId(sessionId: string): SessionIndexRow[] {
  return db.prepare(
    `SELECT * FROM session_index WHERE session_id = ? ORDER BY vendor`
  ).all(sessionId) as SessionIndexRow[];
}

export function listActiveSessions(filter: ActiveSessionFilter = {}): SessionIndexRow[] {
  const states = filter.states && filter.states.length > 0
    ? filter.states
    : ['working', 'idle', 'wedged'] as SessionState[];
  const clauses: string[] = [];
  const params: any[] = [];
  if (filter.projects && filter.projects.length > 0) {
    clauses.push(`project IN (${filter.projects.map(() => '?').join(',')})`);
    params.push(...filter.projects);
  }
  if (filter.roles && filter.roles.length > 0) {
    clauses.push(`role IN (${filter.roles.map(() => '?').join(',')})`);
    params.push(...filter.roles);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM session_index
     ${where}
     ORDER BY last_activity_at DESC`
  ).all(...params) as SessionIndexRow[];
  const allowed = new Set(states);
  // stateForObservation is the single derivation path. Re-aging rows here
  // would make direct DB readers and API readers disagree about one session.
  return rows
    .filter(row => allowed.has(row.state))
    .slice(0, filter.limit ?? 50);
}

export function contextTokensFor(vendor: Vendor, sourcePath: string, sessionId: string): number | null {
  try {
    if (vendor === 'claude') return extractClaudeContextWindow(sourcePath, sessionId);
    if (vendor === 'codex') return extractCodexContextWindow(sourcePath);
    if (vendor === 'gemini') return extractGeminiContextWindow(sourcePath);
    return null;
  } catch {
    // Source file may have rotated, been deleted, or be mid-write. Fall
    // through to null; callers keep the session row visible.
    return null;
  }
}

export function listSessions(filter: SessionBrowserFilter = {}): SessionBrowserPage {
  const clauses: string[] = [];
  const params: any[] = [];
  if (filter.vendor) {
    clauses.push('si.vendor = ?');
    params.push(filter.vendor);
  }
  if (filter.participant_id) {
    clauses.push('si.participant_id = ?');
    params.push(filter.participant_id);
  }
  if (filter.project) {
    clauses.push('si.project = ?');
    params.push(filter.project);
  }
  if (filter.since) {
    clauses.push('julianday(si.last_activity_at) >= julianday(?)');
    params.push(filter.since);
  }
  if (filter.until) {
    clauses.push('julianday(si.last_activity_at) <= julianday(?)');
    params.push(filter.until);
  }
  if (filter.q) {
    clauses.push(`(
      si.session_id LIKE ?
      OR si.participant_id LIKE ?
      OR si.project_role LIKE ?
      OR si.model LIKE ?
      OR si.last_log_line LIKE ?
    )`);
    const needle = `%${filter.q}%`;
    params.push(needle, needle, needle, needle, needle);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  let rows = db.prepare(
    `SELECT
       si.*,
       su.cost_usd AS cost_usd
     FROM session_index si
     LEFT JOIN session_usage su ON su.vendor = si.vendor AND su.session_id = si.session_id
     ${where}`
  ).all(...params) as SessionBrowserRow[];

  // Keep /api/v1/sessions.tokens aligned with /api/v1/tokens/active:
  // latest context-window fill, not cumulative billing tokens. At current
  // browser scale this read-time resolver is sufficient; importer precompute
  // can be added later if this page becomes hot.
  rows = rows.map(row => ({
    ...row,
    // Preserve the stored state; observation ingestion owns derivation.
    tokens: contextTokensFor(row.vendor, row.source_path, row.session_id),
  }));
  if (filter.state) rows = rows.filter(row => row.state === filter.state);

  const sort = filter.sort ?? 'last_activity_at:desc';
  rows.sort((a, b) => {
    if (sort === 'tokens:desc') return (b.tokens ?? -1) - (a.tokens ?? -1);
    if (sort === 'cost_usd:desc') return (b.cost_usd ?? -1) - (a.cost_usd ?? -1);
    const [field, dir] = sort.split(':') as ['last_activity_at' | 'started_at', 'asc' | 'desc'];
    const av = field === 'started_at' ? a.started_at : a.last_activity_at;
    const bv = field === 'started_at' ? b.started_at : b.last_activity_at;
    const at = av ? Date.parse(av) : 0;
    const bt = bv ? Date.parse(bv) : 0;
    return dir === 'asc' ? at - bt : bt - at;
  });

  const total = rows.length;
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 100;
  return { sessions: rows.slice(offset, offset + limit), total, offset, limit };
}

export function getRawSessionEvents(vendor: Vendor, sessionId: string, rawEventId: number | null): RawSessionEventRow[] {
  const namespacedExternalId = `${vendor}:${sessionId}`;
  if (rawEventId !== null) {
    return db.prepare(
      `SELECT id, external_id, timestamp, title, content, metadata
       FROM raw_events
       WHERE id = ? OR external_id = ? OR external_id = ?
       ORDER BY timestamp ASC, id ASC`
    ).all(rawEventId, namespacedExternalId, sessionId) as RawSessionEventRow[];
  }
  return db.prepare(
    `SELECT id, external_id, timestamp, title, content, metadata
     FROM raw_events
     WHERE external_id = ? OR external_id = ?
     ORDER BY timestamp ASC, id ASC`
  ).all(namespacedExternalId, sessionId) as RawSessionEventRow[];
}

function parseSessionUsage(row: SessionUsageRow | undefined): SessionUsage | null {
  if (!row) return null;
  return {
    ...row,
    cost_breakdown: JSON.parse(row.cost_breakdown),
  };
}

export function recordSessionUsage(vendor: Vendor, sessionId: string, usage: TokenUsage, model: string | null): void {
  const session = getSessionByVendorAndId(vendor, sessionId);
  if (!session) {
    throw new Error(`session_index row missing for ${vendor}:${sessionId}`);
  }
  const effectiveModel = model ?? session.model;
  const priced = priceUsage(vendor, effectiveModel, usage);
  db.prepare(
    `INSERT INTO session_usage
       (vendor, session_id, participant_id, model, input_tokens, output_tokens,
        cached_tokens, reasoning_tokens, cost_usd, cost_breakdown, pricing_source, priced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(vendor, session_id) DO UPDATE SET
       participant_id = excluded.participant_id,
       model = excluded.model,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cached_tokens = excluded.cached_tokens,
       reasoning_tokens = excluded.reasoning_tokens,
       cost_usd = excluded.cost_usd,
       cost_breakdown = excluded.cost_breakdown,
       pricing_source = excluded.pricing_source,
       priced_at = excluded.priced_at`
  ).run(
    vendor,
    sessionId,
    session.participant_id,
    effectiveModel,
    usage.input,
    usage.output,
    usage.cached,
    usage.reasoning,
    priced.cost_usd,
    JSON.stringify(priced.cost_breakdown),
    priced.cost_breakdown.source,
  );
}

export function getSessionUsage(vendor: Vendor, sessionId: string): SessionUsage | null {
  const row = db.prepare(
    `SELECT * FROM session_usage WHERE vendor = ? AND session_id = ?`
  ).get(vendor, sessionId) as SessionUsageRow | undefined;
  return parseSessionUsage(row);
}

export function getSessionUsageForMessage(chainMsgId: string): { link: SessionMessageLink; usage: SessionUsage } | null {
  const link = db.prepare(
    `SELECT * FROM session_message_links WHERE chain_msg_id = ?`
  ).get(chainMsgId) as SessionMessageLink | undefined;
  if (!link) return null;
  const usage = getSessionUsage(link.vendor, link.session_id);
  if (!usage) return null;
  return { link, usage };
}

export function aggregateUsageByParticipant(filter: ParticipantUsageFilter): ParticipantUsageAggregateRow[] {
  const clauses = ['si.participant_id IS NOT NULL'];
  const params: any[] = [];
  if (filter.participant_id) {
    clauses.push('si.participant_id = ?');
    params.push(filter.participant_id);
  }
  if (filter.since) {
    clauses.push('julianday(si.last_activity_at) >= julianday(?)');
    params.push(filter.since);
  }
  if (filter.until) {
    clauses.push('julianday(si.last_activity_at) <= julianday(?)');
    params.push(filter.until);
  }
  if (filter.vendor) {
    clauses.push('su.vendor = ?');
    params.push(filter.vendor);
  }
  const rows = db.prepare(
    `SELECT
       si.participant_id AS participant_id,
       su.vendor AS vendor,
       SUM(su.input_tokens) AS input_tokens,
       SUM(su.output_tokens) AS output_tokens,
       SUM(su.cached_tokens) AS cached_tokens,
       SUM(su.reasoning_tokens) AS reasoning_tokens,
       SUM(CASE WHEN su.cost_usd IS NOT NULL THEN su.cost_usd ELSE 0 END) AS priced_cost_usd,
       SUM(CASE WHEN su.cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_session_count,
       COUNT(su.cost_usd) AS priced_session_count,
       COUNT(*) AS session_count
     FROM session_usage su
     JOIN session_index si ON si.vendor = su.vendor AND si.session_id = su.session_id
     WHERE ${clauses.join(' AND ')}
     GROUP BY si.participant_id, su.vendor
     ORDER BY si.participant_id, su.vendor`
  ).all(...params) as Array<{
    participant_id: string;
    vendor: Vendor;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    reasoning_tokens: number;
    priced_cost_usd: number;
    unpriced_session_count: number;
    priced_session_count: number;
    session_count: number;
  }>;

  return rows.map(row => ({
    participant_id: row.participant_id,
    vendor: row.vendor,
    tokens: {
      input: row.input_tokens,
      output: row.output_tokens,
      cached: row.cached_tokens,
      reasoning: row.reasoning_tokens,
    },
    cost_usd: row.priced_session_count > 0 ? row.priced_cost_usd : null,
    unpriced_session_count: row.unpriced_session_count,
    session_count: row.session_count,
  }));
}

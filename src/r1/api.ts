import {
  aggregateUsageByParticipant,
  getSessionUsage,
  getSessionUsageForMessage,
  listActiveSessions,
  listSessionsBySessionId,
} from './session-index.ts';
import {
  formatSseEvent,
  matchesSessionEventFilter,
  replaySessionEvents,
  SESSION_EVENT_CATCHUP_INTERVAL_MS,
  subscribeSessionEvents,
} from './session-events.ts';
import type { ApiError, CostBreakdown, SessionEventRow, SessionIndexRow, SessionState, SessionUsage, Vendor } from './types.ts';

const STATES: readonly SessionState[] = ['working', 'idle', 'wedged', 'completed', 'orphan'];
const DEFAULT_ACTIVE_STATES: SessionState[] = ['working', 'idle', 'wedged'];
const VENDORS: readonly Vendor[] = ['claude', 'codex', 'gemini'];

class ValidationError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function apiError(
  code: ApiError['error']['code'],
  message: string,
  details: Record<string, unknown> = {},
  status = 400,
): Response {
  return json({ error: { code, message, details } }, status);
}

export function parseLimit(value: string | null, defaultValue: number, max: number): number {
  if (value === null || value === '' || value === 'all') return defaultValue;
  if (!/^\d+$/.test(value)) {
    throw new ValidationError('limit must be an integer', { value });
  }
  const n = Number(value);
  if (n < 1) {
    throw new ValidationError('limit must be at least 1', { value: n });
  }
  if (n > max) {
    throw new ValidationError(`limit must be <= ${max}`, { value: n, max });
  }
  return n;
}

export function parseFilter(value: string | null, allowed?: readonly string[]): string[] | null {
  if (value === null || value.trim() === '' || value.trim() === 'all') return null;
  const parts = value.split(',').map(v => v.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new ValidationError('filter must include at least one value', { value });
  }
  const unique = Array.from(new Set(parts));
  if (allowed) {
    const allowedSet = new Set(allowed);
    const invalid = unique.filter(v => !allowedSet.has(v));
    if (invalid.length > 0) {
      throw new ValidationError('filter contains unsupported value', {
        value,
        invalid,
        allowed,
      });
    }
  }
  return unique;
}

function rowToActiveSession(row: SessionIndexRow) {
  return {
    project_role: row.project_role,
    participant_id: row.participant_id,
    session_id: row.session_id,
    vendor: row.vendor,
    model: row.model,
    started_at: row.started_at,
    last_activity_at: row.last_activity_at,
    last_log_line: row.last_log_line,
    state: row.state,
  };
}

function rowToCompactSession(row: SessionIndexRow, now: number) {
  return {
    project_role: row.project_role,
    seconds_ago: Math.floor((now - Date.parse(row.last_activity_at)) / 1000),
    last_log_line: row.last_log_line,
    state: row.state,
  };
}

function parseRequired(value: string | null, name: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new ValidationError(`${name} is required`, { param: name });
  }
  return trimmed;
}

function parseActiveFields(value: string | null): 'compact' | 'full' {
  const fields = value?.trim() ?? '';
  if (fields === '' || fields === 'compact') return 'compact';
  if (fields === 'full') return 'full';
  throw new ValidationError('fields contains unsupported value', {
    value,
    allowed: ['compact', 'full'],
  });
}

function parseVendor(value: string | null): Vendor | null {
  if (value === null || value.trim() === '') return null;
  const vendor = value.trim();
  if (!VENDORS.includes(vendor as Vendor)) {
    throw new ValidationError('vendor contains unsupported value', {
      value,
      allowed: VENDORS,
    });
  }
  return vendor as Vendor;
}

function parseSingleVendor(value: string | null): Vendor | null {
  const vendors = parseFilter(value, VENDORS) as Vendor[] | null;
  if (!vendors) return null;
  if (vendors.length > 1) {
    throw new ValidationError('vendor must include only one value', {
      value,
      allowed: VENDORS,
    });
  }
  return vendors[0];
}

function parseSinceId(value: string | null): number {
  if (value === null || value.trim() === '') return 0;
  if (!/^\d+$/.test(value)) {
    throw new ValidationError('since_id must be a non-negative integer', { value });
  }
  return Number(value);
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};
const DURATION_ALLOWED = [
  '<positive integer>s',
  '<positive integer>m',
  '<positive integer>h',
  '<positive integer>d',
];

function parseDuration(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  const match = /^([1-9][0-9]*)([smhd])$/.exec(trimmed);
  if (!match) {
    throw new ValidationError('window must be a positive integer duration', {
      value,
      allowed: DURATION_ALLOWED,
    });
  }
  const amount = Number(match[1]);
  const durationMs = amount * DURATION_UNITS[match[2]];
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(durationMs)) {
    throw new ValidationError('window must be a representable duration', {
      value,
      allowed: DURATION_ALLOWED,
    });
  }
  return durationMs;
}

function parseIsoTimestamp(value: string | null, name: string): string | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) {
    throw new ValidationError(`${name} must be a valid ISO timestamp`, { param: name, value });
  }
  return new Date(time).toISOString();
}

function publicBreakdown(breakdown: CostBreakdown) {
  return {
    model: breakdown.model,
    source: breakdown.source,
    lines: breakdown.lines,
  };
}

function rowToCostResponse(usage: SessionUsage) {
  return {
    session_id: usage.session_id,
    participant: usage.participant_id,
    vendor: usage.vendor,
    tokens: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cached: usage.cached_tokens,
      reasoning: usage.reasoning_tokens,
    },
    cost_usd: usage.cost_usd,
    cost_breakdown: publicBreakdown(usage.cost_breakdown),
  };
}

type ParticipantUsageSummary = {
  participant_id: string;
  tokens: ReturnType<typeof zeroTokens>;
  cost_usd: number | null;
  unpriced_session_count: number;
  session_count: number;
  by_vendor: Record<Vendor, {
    tokens: ReturnType<typeof zeroTokens>;
    cost_usd: number | null;
    unpriced_session_count: number;
    session_count: number;
  }>;
};

function summarizeParticipantUsage(participantId: string, rows: ReturnType<typeof aggregateUsageByParticipant>): ParticipantUsageSummary {
  const tokens = zeroTokens();
  const byVendor: ParticipantUsageSummary['by_vendor'] = {} as any;
  let pricedCost = 0;
  let pricedVendorCount = 0;
  let unpricedSessionCount = 0;
  let sessionCount = 0;

  for (const row of rows) {
    foldTokenTotals(tokens, row.tokens);
    if (row.cost_usd !== null) {
      pricedCost += row.cost_usd;
      pricedVendorCount++;
    }
    unpricedSessionCount += row.unpriced_session_count;
    sessionCount += row.session_count;
    byVendor[row.vendor] = {
      tokens: row.tokens,
      cost_usd: row.cost_usd,
      unpriced_session_count: row.unpriced_session_count,
      session_count: row.session_count,
    };
  }

  return {
    participant_id: participantId,
    tokens,
    cost_usd: sessionCount > 0 && pricedVendorCount > 0 ? pricedCost : null,
    unpriced_session_count: unpricedSessionCount,
    session_count: sessionCount,
    by_vendor: byVendor,
  };
}

function zeroTokens() {
  return { input: 0, output: 0, cached: 0, reasoning: 0 };
}

function foldTokenTotals(target: ReturnType<typeof zeroTokens>, source: ReturnType<typeof zeroTokens>) {
  target.input += source.input;
  target.output += source.output;
  target.cached += source.cached;
  target.reasoning += source.reasoning;
}

export function handleActiveSessions(url: URL): Response {
  try {
    const generatedAt = new Date();
    const now = generatedAt.getTime();
    const fields = parseActiveFields(url.searchParams.get('fields'));
    const limit = parseLimit(url.searchParams.get('limit'), 50, 200);
    const projects = parseFilter(url.searchParams.get('project'));
    const roles = parseFilter(url.searchParams.get('role'));
    const stateFilter = parseFilter(url.searchParams.get('state'), STATES) as SessionState[] | null;
    const states = stateFilter ?? DEFAULT_ACTIVE_STATES;
    const rows = listActiveSessions({ projects, roles, states, limit });
    const sessions = fields === 'full'
      ? rows.map(rowToActiveSession)
      : rows.map(row => rowToCompactSession(row, now));
    return json({
      sessions,
      generated_at: generatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return apiError('validation', error.message, error.details ?? {}, 400);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return apiError('internal', 'Internal server error', { message }, 500);
  }
}

export function handleCostBySession(url: URL): Response {
  try {
    const sessionId = parseRequired(url.searchParams.get('session_id'), 'session_id');
    const vendor = parseVendor(url.searchParams.get('vendor'));

    if (vendor) {
      const usage = getSessionUsage(vendor, sessionId);
      if (!usage) return apiError('not_found', 'Session usage not found', { session_id: sessionId, vendor }, 404);
      return json(rowToCostResponse(usage));
    }

    const sessions = listSessionsBySessionId(sessionId);
    if (sessions.length === 0) {
      return apiError('not_found', 'Session not found', { session_id: sessionId }, 404);
    }
    if (sessions.length > 1) {
      return apiError('ambiguous', 'session_id matches multiple vendors; include vendor', {
        session_id: sessionId,
        vendors: sessions.map(session => session.vendor),
      }, 409);
    }
    const session = sessions[0];
    const usage = getSessionUsage(session.vendor, sessionId);
    if (!usage) return apiError('not_found', 'Session usage not found', { session_id: sessionId, vendor: session.vendor }, 404);
    return json(rowToCostResponse(usage));
  } catch (error) {
    if (error instanceof ValidationError) {
      return apiError('validation', error.message, error.details ?? {}, 400);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return apiError('internal', 'Internal server error', { message }, 500);
  }
}

export function handleCostByMessage(url: URL): Response {
  try {
    const chainMsgId = parseRequired(url.searchParams.get('chain_msg_id'), 'chain_msg_id');
    const row = getSessionUsageForMessage(chainMsgId);
    if (!row) {
      return apiError('not_found', 'Message link or session usage not found', { chain_msg_id: chainMsgId }, 404);
    }
    return json({
      ...rowToCostResponse(row.usage),
      chain_msg_id: chainMsgId,
      link_confidence: row.link.confidence,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return apiError('validation', error.message, error.details ?? {}, 400);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return apiError('internal', 'Internal server error', { message }, 500);
  }
}

export function handleTokensByParticipant(url: URL): Response {
  try {
    const participantId = url.searchParams.get('participant_id')?.trim() || null;
    if (url.searchParams.get('since') && url.searchParams.get('window')) {
      throw new ValidationError('since and window are mutually exclusive', {
        conflict: ['since', 'window'],
      });
    }

    const windowMs = parseDuration(url.searchParams.get('window'));
    // Use session_index.last_activity_at for time filters. The orchestrator
    // needs usage by work time, not by importer/pricing cadence.
    let since = parseIsoTimestamp(url.searchParams.get('since'), 'since');
    if (windowMs !== null) {
      const sinceMs = Date.now() - windowMs;
      if (!Number.isFinite(sinceMs) || Number.isNaN(new Date(sinceMs).getTime())) {
        throw new ValidationError('window must be a representable duration', {
          value: url.searchParams.get('window'),
          allowed: DURATION_ALLOWED,
        });
      }
      since = new Date(sinceMs).toISOString();
    }
    const until = parseIsoTimestamp(url.searchParams.get('until'), 'until');
    const vendor = parseSingleVendor(url.searchParams.get('vendor'));

    const rows = aggregateUsageByParticipant({
      participant_id: participantId,
      since,
      until,
      vendor,
    });
    const generated_at = new Date().toISOString();

    if (participantId) {
      return json({
        ...summarizeParticipantUsage(participantId, rows),
        generated_at,
      });
    }

    const byParticipant = new Map<string, typeof rows>();
    for (const row of rows) {
      const participantRows = byParticipant.get(row.participant_id) ?? [];
      participantRows.push(row);
      byParticipant.set(row.participant_id, participantRows);
    }

    return json({
      participants: Array.from(byParticipant)
        .map(([id, groupedRows]) => summarizeParticipantUsage(id, groupedRows)),
      generated_at,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return apiError('validation', error.message, error.details ?? {}, 400);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return apiError('internal', 'Internal server error', { message }, 500);
  }
}

export function handleSessionEvents(req: Request, url: URL): Response {
  let sinceId: number;
  let projects: string[] | null;
  let roles: string[] | null;
  try {
    sinceId = parseSinceId(url.searchParams.get('since_id'));
    projects = parseFilter(url.searchParams.get('project'));
    roles = parseFilter(url.searchParams.get('role'));
  } catch (error) {
    if (error instanceof ValidationError) {
      return apiError('validation', error.message, error.details ?? {}, 400);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return apiError('internal', 'Internal server error', { message }, 500);
  }

  const filter = { projects, roles };
  const encoder = new TextEncoder();
  let cleanupStream: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let replayDone = false;
      let lastSent = sinceId;
      let buffered: SessionEventRow[] = [];
      let timer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        timer = null;
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
      };
      cleanupStream = cleanup;

      const emit = (row: SessionEventRow) => {
        if (closed || row.id <= lastSent || !matchesSessionEventFilter(row, filter)) return;
        try {
          controller.enqueue(encoder.encode(formatSseEvent(row)));
          lastSent = row.id;
        } catch {
          cleanup();
        }
      };

      try {
        controller.enqueue(encoder.encode(': connected\n\n'));
      } catch {
        cleanup();
        return;
      }

      unsubscribe = subscribeSessionEvents(row => {
        if (closed || row.id <= lastSent || !matchesSessionEventFilter(row, filter)) return;
        if (!replayDone) {
          buffered = [...buffered, row];
          return;
        }
        emit(row);
      });

      try {
        for (const row of replaySessionEvents(sinceId, filter)) emit(row);
        replayDone = true;
        for (const row of buffered.sort((a, b) => a.id - b.id)) emit(row);
        buffered = [];
      } catch {
        cleanup();
        try { controller.close(); } catch {}
        return;
      }

      timer = setInterval(() => {
        try {
          for (const row of replaySessionEvents(lastSent, filter)) emit(row);
        } catch {
          cleanup();
          try { controller.close(); } catch {}
        }
      }, SESSION_EVENT_CATCHUP_INTERVAL_MS);
      (timer as any).unref?.();

      req.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch {}
      }, { once: true });
    },
    cancel() {
      cleanupStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

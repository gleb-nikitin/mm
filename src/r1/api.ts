import {
  getSessionUsage,
  getSessionUsageForMessage,
  listActiveSessions,
  listSessionsBySessionId,
} from './session-index.ts';
import type { ApiError, CostBreakdown, SessionIndexRow, SessionState, SessionUsage, Vendor } from './types.ts';

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

function parseRequired(value: string | null, name: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new ValidationError(`${name} is required`, { param: name });
  }
  return trimmed;
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

export function handleActiveSessions(url: URL): Response {
  try {
    const limit = parseLimit(url.searchParams.get('limit'), 50, 200);
    const projects = parseFilter(url.searchParams.get('project'));
    const roles = parseFilter(url.searchParams.get('role'));
    const stateFilter = parseFilter(url.searchParams.get('state'), STATES) as SessionState[] | null;
    const states = stateFilter ?? DEFAULT_ACTIVE_STATES;
    const sessions = listActiveSessions({ projects, roles, states, limit }).map(rowToActiveSession);
    return json({
      sessions,
      generated_at: new Date().toISOString(),
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

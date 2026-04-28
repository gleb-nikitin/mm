import { listActiveSessions } from './session-index.ts';
import type { ApiError, SessionIndexRow, SessionState } from './types.ts';

const STATES: readonly SessionState[] = ['working', 'idle', 'wedged', 'completed', 'orphan'];
const DEFAULT_ACTIVE_STATES: SessionState[] = ['working', 'idle', 'wedged'];

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

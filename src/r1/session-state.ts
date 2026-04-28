import type { SessionEventType, SessionState } from './types.ts';

// Session state is derived before event emission. First observations always map
// to `session_started` and carry the derived state in payload; transition events
// (`session_idle`, `session_orphaned`, etc.) only fire after an existing session
// changes state.

export const DEFAULT_IDLE_SECONDS = Number(process.env.MT_R1_IDLE_SECONDS ?? 300);
export const DEFAULT_WEDGED_SECONDS = Number(process.env.MT_R1_WEDGED_SECONDS ?? 900);

export type DeriveSessionStateInput = {
  linked: boolean;
  completed?: boolean;
  explicitState?: SessionState | null;
  last_activity_at: string;
  nowMs?: number;
  idleSeconds?: number;
  wedgedSeconds?: number;
};

function parseTimeMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function deriveSessionState(input: DeriveSessionStateInput): SessionState {
  if (!input.linked) return 'orphan';
  if (input.completed || input.explicitState === 'completed') return 'completed';
  if (input.explicitState === 'working' || input.explicitState === 'idle' || input.explicitState === 'wedged') {
    return input.explicitState;
  }

  const activityMs = parseTimeMs(input.last_activity_at);
  if (activityMs === null) return 'working';

  const nowMs = input.nowMs ?? Date.now();
  const ageSeconds = (nowMs - activityMs) / 1000;
  const wedgedSeconds = input.wedgedSeconds ?? DEFAULT_WEDGED_SECONDS;
  const idleSeconds = input.idleSeconds ?? DEFAULT_IDLE_SECONDS;
  if (ageSeconds > wedgedSeconds) return 'wedged';
  if (ageSeconds > idleSeconds) return 'idle';
  return 'working';
}

export function eventTypeForStateChange(previous: SessionState | null, next: SessionState): SessionEventType | null {
  if (previous === null) return 'session_started';
  if (previous === next) return null;
  if (next === 'working') return 'session_active';
  if (next === 'idle') return 'session_idle';
  if (next === 'wedged') return 'session_wedged';
  if (next === 'completed') return 'session_completed';
  if (next === 'orphan') return 'session_orphaned';
  return null;
}

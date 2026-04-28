export type Vendor = 'claude' | 'codex' | 'gemini';

export type SessionState = 'working' | 'idle' | 'wedged' | 'completed' | 'orphan';

export type SessionEventType =
  | 'session_started'
  | 'session_active'
  | 'session_idle'
  | 'session_wedged'
  | 'session_completed'
  | 'session_orphaned';

export type LinkConfidence = 'exact' | 'footer' | 'none';

export type SessionLink = {
  participant_id: string;
  project: string | null;
  role: string | null;
  project_role: string | null;
};

export type SessionObservation = {
  vendor: Vendor;
  session_id: string;
  source_path: string;
  raw_event_id: number | null;
  project: string;
  cwd: string | null;
  model: string | null;
  started_at: string | null;
  last_activity_at: string;
  last_mtime: number;
  last_log_line: string | null;
  state?: SessionState;
  orphan_reason?: string | null;
  metadata?: string | null;
};

export type SessionIndexRow = {
  vendor: Vendor;
  session_id: string;
  source_path: string;
  raw_event_id: number | null;
  participant_id: string | null;
  project: string;
  role: string | null;
  project_role: string | null;
  cwd: string | null;
  model: string | null;
  started_at: string | null;
  last_activity_at: string;
  last_imported_at: string;
  last_mtime: number;
  last_log_line: string | null;
  state: SessionState;
  orphan_reason: string | null;
  metadata: string | null;
};

export type ParsedMessageFooter = {
  chain: string | null;
  seq: number | null;
  from_id: string | null;
  to_id: string | null;
  chain_msg_id: string | null;
  confidence: LinkConfidence;
};

export type SessionMessageLink = ParsedMessageFooter & {
  chain_msg_id: string;
  vendor: Vendor;
  session_id: string;
  participant_id: string | null;
  source_path: string | null;
};

export type TokenUsage = {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  cache_creation_5m?: number;
  cache_creation_1h?: number;
  cache_read?: number;
};

export type TokenType = 'input' | 'output' | 'cached' | 'reasoning';
export type CostLineType = TokenType | 'cache_creation_5m' | 'cache_creation_1h' | 'cache_read';

export type CostBreakdownLine = {
  type: CostLineType;
  tokens: number;
  rate: number | null;
  cost: number | null;
};

export type PricingSource = 'pricing.toml' | 'unknown' | 'stale';

export type CostBreakdown = {
  model: string | null;
  source: PricingSource;
  lines: CostBreakdownLine[];
};

export type PricedUsage = {
  cost_usd: number | null;
  cost_breakdown: CostBreakdown;
};

export type SessionUsageRow = {
  vendor: Vendor;
  session_id: string;
  participant_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost_usd: number | null;
  cost_breakdown: string;
  pricing_source: PricingSource;
  priced_at: string;
};

export type SessionUsage = Omit<SessionUsageRow, 'cost_breakdown'> & {
  cost_breakdown: CostBreakdown;
};

export type SessionEventRow = {
  id: number;
  event_type: SessionEventType;
  vendor: Vendor;
  session_id: string;
  participant_id: string | null;
  project_role: string | null;
  timestamp: string;
  last_log_line: string | null;
  payload: string;
  created_at: string;
};

export type SessionEvent = Omit<SessionEventRow, 'payload'> & {
  payload: Record<string, unknown>;
};

export type ApiError = {
  error: {
    code: 'validation' | 'internal' | 'not_found' | 'ambiguous' | 'mm_unavailable';
    message: string;
    details?: Record<string, unknown>;
  };
};

export type Vendor = 'claude' | 'codex' | 'gemini';

export type SessionState = 'working' | 'idle' | 'wedged' | 'completed' | 'orphan';

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

export type ApiError = {
  error: {
    code: 'validation' | 'internal' | 'not_found' | 'ambiguous' | 'mm_unavailable';
    message: string;
    details?: Record<string, unknown>;
  };
};

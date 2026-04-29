import * as fs from 'fs';
import type { TokenUsage } from './types.ts';

function zeroUsage(): TokenUsage {
  return { input: 0, output: 0, cached: 0, reasoning: 0 };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function add(a: TokenUsage, b: TokenUsage): TokenUsage {
  const out: TokenUsage = {
    input: a.input + b.input,
    output: a.output + b.output,
    cached: a.cached + b.cached,
    reasoning: a.reasoning + b.reasoning,
  };
  if (a.cache_creation_5m !== undefined || b.cache_creation_5m !== undefined) {
    out.cache_creation_5m = (a.cache_creation_5m ?? 0) + (b.cache_creation_5m ?? 0);
  }
  if (a.cache_creation_1h !== undefined || b.cache_creation_1h !== undefined) {
    out.cache_creation_1h = (a.cache_creation_1h ?? 0) + (b.cache_creation_1h ?? 0);
  }
  if (a.cache_read !== undefined || b.cache_read !== undefined) {
    out.cache_read = (a.cache_read ?? 0) + (b.cache_read ?? 0);
  }
  return out;
}

function readJsonl(filePath: string): any[] {
  const records: any[] = [];
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return records;
}

/**
 * Latest-turn context-window fill for a Claude session.
 *
 * Each assistant message's `usage` reports the cumulative context size for
 * that turn — `input_tokens`, `cache_creation_input_tokens`, and
 * `cache_read_input_tokens` are non-overlapping. The last assistant message
 * with usage represents current context occupancy. Drives relaunch-decision
 * signals; not for billing.
 *
 * Mirrors ac's session-tracker (battle-tested):
 *   total = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *
 * Distinct from extractClaudeTokenUsage, which sums per response for cost.
 */
export function extractClaudeContextWindow(filePath: string, sessionId: string): number {
  let total = 0;
  for (const rec of readJsonl(filePath)) {
    if (rec?.sessionId !== sessionId || rec?.type !== 'assistant') continue;
    const usage = rec?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    total =
      num(usage.input_tokens) +
      num(usage.cache_creation_input_tokens) +
      num(usage.cache_read_input_tokens);
  }
  return total;
}

/**
 * Latest-turn context-window fill for a Codex session.
 *
 * Per Codex API semantics (confirmed by the Codex agent):
 *   - Each `event_msg` with `payload.type === 'token_count'` carries
 *     `payload.info.last_token_usage`; its `input_tokens` is the
 *     prompt-side context size for that turn (already includes
 *     `cached_input_tokens` — cached is a subset, not additive).
 *   - `total_token_usage` is cumulative across the session and MUST NOT
 *     be used as a fallback — it would overstate context fill.
 *   - If `last_token_usage` is missing on every event, return null.
 *
 * Picks the latest non-zero `last_token_usage.input_tokens`. Trailing
 * zero-input events (Codex emits these post-turn as session signals)
 * would otherwise clobber the real value via the >= tie-break that
 * matches the cumulative extractor.
 */
export function extractCodexContextWindow(filePath: string): number | null {
  let latestInput: number | null = null;
  let latestTimestamp = '';
  for (const rec of readJsonl(filePath)) {
    if (rec?.type !== 'event_msg' || rec?.payload?.type !== 'token_count') continue;
    const info = rec.payload.info;
    if (!info?.last_token_usage) continue;
    const input = num(info.last_token_usage.input_tokens);
    if (input <= 0) continue;
    const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : '';
    if (latestInput === null || timestamp >= latestTimestamp) {
      latestInput = input;
      latestTimestamp = timestamp;
    }
  }
  return latestInput;
}

/**
 * Latest-turn context-window fill for a Gemini session.
 *
 * Per Gemini API semantics (confirmed by the Gemini agent):
 *   - `usageMetadata.promptTokenCount` on a model message is the *total*
 *     input tokens for that turn (history + current prompt).
 *   - `cachedContentTokenCount` is a *subset* breakdown of promptTokenCount,
 *     not additive. Don't sum.
 *   - Legacy `tokens.input` field is the equivalent of promptTokenCount.
 *
 * Walks both the single-JSON-with-messages[] and JSONL shapes (mirrors
 * `extractGeminiTokenUsage`). Returns the *last* model message's
 * prompt-side total. Returns null if no usage data is present.
 */
export function extractGeminiContextWindow(filePath: string): number | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  let records: any[] = [];
  try {
    records = [JSON.parse(content)];
  } catch {
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
  }

  let latest: number | null = null;
  const visit = (message: any) => {
    if (message?.tokens && typeof message.tokens === 'object' && typeof message.tokens.input === 'number') {
      latest = num(message.tokens.input);
      return;
    }
    if (message?.usageMetadata && typeof message.usageMetadata.promptTokenCount === 'number') {
      latest = num(message.usageMetadata.promptTokenCount);
    }
  };
  for (const rec of records) {
    if (Array.isArray(rec?.messages)) {
      for (const message of rec.messages) {
        if (message?.type !== 'gemini' && !message?.usageMetadata) continue;
        visit(message);
      }
    } else if (rec?.type === 'gemini' || rec?.usageMetadata) {
      visit(rec);
    }
  }
  return latest;
}

export function extractClaudeTokenUsage(filePath: string, sessionId: string): TokenUsage {
  const usageByResponse = new Map<string, TokenUsage>();
  let anonymousIndex = 0;
  for (const rec of readJsonl(filePath)) {
    if (rec?.sessionId !== sessionId || rec?.type !== 'assistant') continue;
    const usage = rec?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const explicit5m = num(usage.cache_creation?.ephemeral_5m_input_tokens);
    const explicit1h = num(usage.cache_creation?.ephemeral_1h_input_tokens);
    const topLevelCreation = num(usage.cache_creation_input_tokens);
    const creation5m = explicit5m || explicit1h ? explicit5m : topLevelCreation;
    const creation1h = explicit1h;
    const read = num(usage.cache_read_input_tokens);
    const responseUsage = {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cached: creation5m + creation1h + read,
      reasoning: 0,
      cache_creation_5m: creation5m,
      cache_creation_1h: creation1h,
      cache_read: read,
    };
    // Claude JSONL can repeat the same API response usage across streamed
    // thinking/text/tool records. Keep final usage per stable response id.
    const messageId = typeof rec?.message?.id === 'string' ? rec.message.id : '';
    const requestId = typeof rec?.requestId === 'string' ? rec.requestId : '';
    const key = messageId || requestId || `anonymous:${anonymousIndex++}`;
    usageByResponse.set(key, responseUsage);
  }

  let total = zeroUsage();
  for (const usage of usageByResponse.values()) total = add(total, usage);
  return total;
}

function codexUsageFromBlock(block: any): TokenUsage {
  return {
    input: num(block?.input_tokens),
    output: num(block?.output_tokens),
    cached: num(block?.cached_input_tokens),
    reasoning: num(block?.reasoning_output_tokens),
  };
}

function usageScore(usage: TokenUsage): number {
  return usage.input + usage.output + usage.cached + usage.reasoning;
}

export function extractCodexTokenUsage(filePath: string): TokenUsage {
  let latestTotal: TokenUsage | null = null;
  let latestTotalTimestamp = '';
  let latestLast: TokenUsage | null = null;
  let latestLastTimestamp = '';

  for (const rec of readJsonl(filePath)) {
    if (rec?.type !== 'event_msg' || rec?.payload?.type !== 'token_count') continue;
    const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : '';
    const info = rec.payload.info;
    if (info?.total_token_usage) {
      const candidate = codexUsageFromBlock(info.total_token_usage);
      if (
        !latestTotal ||
        timestamp > latestTotalTimestamp ||
        (timestamp === latestTotalTimestamp && usageScore(candidate) >= usageScore(latestTotal))
      ) {
        latestTotal = candidate;
        latestTotalTimestamp = timestamp;
      }
    }
    if (info?.last_token_usage) {
      const candidate = codexUsageFromBlock(info.last_token_usage);
      // Fallback only: when Codex omits cumulative totals, use the most recent
      // last_token_usage snapshot instead of summing repeated telemetry rows.
      if (!latestLast || timestamp >= latestLastTimestamp) {
        latestLast = candidate;
        latestLastTimestamp = timestamp;
      }
    }
  }

  return latestTotal ?? latestLast ?? zeroUsage();
}

function geminiUsageFromMessage(message: any): TokenUsage {
  const tokens = message?.tokens;
  if (tokens && typeof tokens === 'object') {
    return {
      input: num(tokens.input),
      output: num(tokens.output),
      cached: num(tokens.cached),
      reasoning: num(tokens.thoughts),
    };
  }
  const usage = message?.usageMetadata;
  if (usage && typeof usage === 'object') {
    return {
      input: num(usage.promptTokenCount),
      output: num(usage.candidatesTokenCount),
      cached: num(usage.cachedContentTokenCount),
      reasoning: num(usage.thoughtsTokenCount),
    };
  }
  return zeroUsage();
}

export function extractGeminiTokenUsage(filePath: string): TokenUsage {
  const content = fs.readFileSync(filePath, 'utf-8');
  let records: any[] = [];
  try {
    records = [JSON.parse(content)];
  } catch {
    // Fallback to JSONL: each line is either a session or a message
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
  }

  let total = zeroUsage();
  for (const rec of records) {
    if (Array.isArray(rec?.messages)) {
      for (const message of rec.messages) {
        if (message?.type !== 'gemini' && !message?.usageMetadata) continue;
        total = add(total, geminiUsageFromMessage(message));
      }
    } else if (rec?.type === 'gemini' || rec?.usageMetadata) {
      total = add(total, geminiUsageFromMessage(rec));
    }
  }
  return total;
}

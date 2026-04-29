import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import {
  extractClaudeContextWindow,
  extractClaudeTokenUsage,
  extractCodexContextWindow,
  extractCodexTokenUsage,
  extractGeminiContextWindow,
  extractGeminiTokenUsage,
} from '../src/r1/token-usage.ts';

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'r1');

describe('R1 token usage extraction', () => {
  test('Claude sums assistant message.usage for the requested session', () => {
    expect(extractClaudeTokenUsage(path.join(FIXTURES, 'claude', 'session.jsonl'), 'claude-fixture')).toEqual({
      input: 100,
      output: 20,
      cached: 70,
      reasoning: 0,
      cache_creation_5m: 30,
      cache_creation_1h: 0,
      cache_read: 40,
    });
  });

  test('Claude deduplicates repeated streamed records for the same response', () => {
    expect(extractClaudeTokenUsage(path.join(FIXTURES, 'claude', 'duplicate-usage.jsonl'), 'claude-duplicate')).toEqual({
      input: 15,
      output: 27,
      cached: 81,
      reasoning: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 30,
      cache_read: 51,
    });
  });

  test('Codex uses the latest cumulative total_token_usage snapshot', () => {
    expect(extractCodexTokenUsage(path.join(FIXTURES, 'codex', 'repeated-token-count.jsonl'))).toEqual({
      input: 130,
      output: 30,
      cached: 40,
      reasoning: 7,
    });
  });

  test('Codex falls back to the most recent last_token_usage when cumulative totals are absent', () => {
    expect(extractCodexTokenUsage(path.join(FIXTURES, 'codex', 'last-only.jsonl'))).toEqual({
      input: 20,
      output: 4,
      cached: 2,
      reasoning: 6,
    });
  });

  test('Gemini sums message tokens with usageMetadata fallback', () => {
    expect(extractGeminiTokenUsage(path.join(FIXTURES, 'gemini', 'session.json'))).toEqual({
      input: 120,
      output: 30,
      cached: 12,
      reasoning: 7,
    });
  });

  test('Gemini sums tokens from JSONL records', () => {
    expect(extractGeminiTokenUsage(path.join(FIXTURES, 'gemini', 'session.jsonl'))).toEqual({
      input: 30,    // 10 + 20
      output: 15,   // 5 + 10
      cached: 5,    // 0 + 5
      reasoning: 2, // 0 + 2
    });
  });

  test('Claude context window returns the latest assistant message usage sum', () => {
    // Single assistant with usage: 100 + 30 + 40 = 170. The follow-up
    // record without usage must NOT reset to zero (mirrors ac's "if usage
    // present, overwrite" semantics). Other-session records are ignored.
    expect(extractClaudeContextWindow(path.join(FIXTURES, 'claude', 'session.jsonl'), 'claude-fixture')).toBe(170);
  });

  test('Claude context window picks the last response across streamed records', () => {
    // msg_1 streamed twice (10+30+40=80), then msg_2 (5+0+11=16). Last
    // wins → 16. Same dedup-tolerance as the cumulative extractor, but
    // selecting last instead of summing all.
    expect(extractClaudeContextWindow(path.join(FIXTURES, 'claude', 'duplicate-usage.jsonl'), 'claude-duplicate')).toBe(16);
  });

  test('Claude context window returns zero for sessions with no matching records', () => {
    expect(extractClaudeContextWindow(path.join(FIXTURES, 'claude', 'session.jsonl'), 'no-such-session')).toBe(0);
  });

  test('Codex context-window stub returns null pending vendor implementation', () => {
    expect(extractCodexContextWindow(path.join(FIXTURES, 'codex', 'repeated-token-count.jsonl'))).toBeNull();
  });

  test('Gemini context window returns the last message prompt-token total (JSON shape)', () => {
    // Two model messages; last one uses usageMetadata.promptTokenCount = 70.
    // The earlier tokens.input = 50 is overwritten — last wins, no summing.
    expect(extractGeminiContextWindow(path.join(FIXTURES, 'gemini', 'session.json'))).toBe(70);
  });

  test('Gemini context window returns the last message prompt-token total (JSONL shape)', () => {
    // Two gemini lines; last has promptTokenCount = 20.
    expect(extractGeminiContextWindow(path.join(FIXTURES, 'gemini', 'session.jsonl'))).toBe(20);
  });
});

import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { extractClaudeTokenUsage, extractCodexTokenUsage, extractGeminiTokenUsage } from '../src/r1/token-usage.ts';

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
});

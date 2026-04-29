import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configurePricingFile, priceUsage, stopPricingWatcherForTests } from '../src/r1/pricing.ts';

function tmpPricingFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-r1-pricing-'));
  const file = path.join(dir, 'pricing.toml');
  fs.writeFileSync(file, contents);
  return file;
}

async function waitForPrice(file: string, expected: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const priced = priceUsage('codex', 'codex-test', { input: 100, output: 0, cached: 0, reasoning: 0 });
    if (priced.cost_usd === expected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`pricing file did not reload: ${file}`);
}

describe('R1 pricing', () => {
  afterEach(() => {
    stopPricingWatcherForTests();
  });

  test('prices Codex cached input as a subset of input tokens', () => {
    const file = tmpPricingFile(`
[codex."codex-test"]
input = 10
output = 20
cached = 1
reasoning = 20
`);
    configurePricingFile(file, { watch: false });
    const priced = priceUsage('codex', 'codex-test', {
      input: 1_000_000,
      output: 500_000,
      cached: 100_000,
      reasoning: 25_000,
    });
    expect(priced.cost_usd).toBe(19.1);
    expect(priced.cost_breakdown.source).toBe('pricing.toml');
    expect(priced.cost_breakdown.lines).toEqual([
      { type: 'input', tokens: 900_000, rate: 10, cost: 9 },
      { type: 'cached', tokens: 100_000, rate: 1, cost: 0.1 },
      { type: 'output', tokens: 500_000, rate: 20, cost: 10 },
    ]);
  });

  test('prices Gemini cached input as a subset of input tokens', () => {
    const file = tmpPricingFile(`
[gemini."gemini-test"]
input = 0.5
output = 3.0
cached = 0.05
reasoning = 3.0
`);
    configurePricingFile(file, { watch: false });
    const priced = priceUsage('gemini', 'gemini-test', {
      input: 1_000_000,
      output: 500_000,
      cached: 200_000,
      reasoning: 50_000,
    });
    // input cost: (1,000,000 - 200,000) * 0.5 / 1,000,000 = 0.4
    // cached cost: 200,000 * 0.05 / 1,000,000 = 0.01
    // output cost: 500,000 * 3.0 / 1,000,000 = 1.5
    // reasoning cost: 50,000 * 3.0 / 1,000,000 = 0.15
    // total: 0.4 + 0.01 + 1.5 + 0.15 = 2.06
    expect(priced.cost_usd).toBe(2.06);
    expect(priced.cost_breakdown.lines).toEqual([
      { type: 'input', tokens: 800_000, rate: 0.5, cost: 0.4 },
      { type: 'output', tokens: 500_000, rate: 3.0, cost: 1.5 },
      { type: 'cached', tokens: 200_000, rate: 0.05, cost: 0.01 },
      { type: 'reasoning', tokens: 50_000, rate: 3.0, cost: 0.15 },
    ]);
  });

  test('prices Claude cache writes and reads as separate line items', () => {
    const file = tmpPricingFile(`
[claude."claude-opus-4-6"]
input = 5
output = 25
cache_creation_5m = 6.25
cache_creation_1h = 10
cache_read = 0.5
reasoning = 25
`);
    configurePricingFile(file, { watch: false });
    const priced = priceUsage('claude', 'claude-opus-4-6', {
      input: 0,
      output: 0,
      cached: 70,
      reasoning: 0,
      cache_creation_5m: 30,
      cache_creation_1h: 0,
      cache_read: 40,
    });
    expect(priced.cost_usd).toBe(0.0002075);
    expect(priced.cost_breakdown.lines).toEqual([
      { type: 'input', tokens: 0, rate: 5, cost: 0 },
      { type: 'output', tokens: 0, rate: 25, cost: 0 },
      { type: 'cache_creation_5m', tokens: 30, rate: 6.25, cost: 0.0001875 },
      { type: 'cache_creation_1h', tokens: 0, rate: 10, cost: 0 },
      { type: 'cache_read', tokens: 40, rate: 0.5, cost: 0.00002 },
      { type: 'reasoning', tokens: 0, rate: 25, cost: 0 },
    ]);
  });

  test('prices Claude input and output when cache tokens are zero', () => {
    const file = tmpPricingFile(`
[claude."claude-opus-4-6"]
input = 5
output = 25
cache_creation_5m = 6.25
cache_creation_1h = 10
cache_read = 0.5
reasoning = 25
`);
    configurePricingFile(file, { watch: false });
    const priced = priceUsage('claude', 'claude-opus-4-6', {
      input: 1000,
      output: 100,
      cached: 0,
      reasoning: 0,
      cache_creation_5m: 0,
      cache_creation_1h: 0,
      cache_read: 0,
    });
    expect(priced.cost_usd).toBe(0.0075);
    expect(priced.cost_breakdown.source).toBe('pricing.toml');
    expect(priced.cost_breakdown.lines).toEqual([
      { type: 'input', tokens: 1000, rate: 5, cost: 0.005 },
      { type: 'output', tokens: 100, rate: 25, cost: 0.0025 },
      { type: 'cache_creation_5m', tokens: 0, rate: 6.25, cost: 0 },
      { type: 'cache_creation_1h', tokens: 0, rate: 10, cost: 0 },
      { type: 'cache_read', tokens: 0, rate: 0.5, cost: 0 },
      { type: 'reasoning', tokens: 0, rate: 25, cost: 0 },
    ]);
  });

  test('unknown model keeps token counts visible with null cost', () => {
    const file = tmpPricingFile(`[codex."known"]\ninput = 1\noutput = 1\ncached = 1\nreasoning = 1\n`);
    configurePricingFile(file, { watch: false });
    const priced = priceUsage('codex', 'missing', { input: 100, output: 20, cached: 30, reasoning: 40 });
    expect(priced.cost_usd).toBeNull();
    expect(priced.cost_breakdown.source).toBe('unknown');
    expect(priced.cost_breakdown.lines).toEqual([
      { type: 'input', tokens: 70, rate: null, cost: null },
      { type: 'cached', tokens: 30, rate: null, cost: null },
      { type: 'output', tokens: 20, rate: null, cost: null },
    ]);
  });

  test('reloads when pricing.toml changes', async () => {
    const file = tmpPricingFile(`
[codex."codex-test"]
input = 10
output = 1
cached = 1
reasoning = 1
`);
    configurePricingFile(file, { watch: true });
    expect(priceUsage('codex', 'codex-test', { input: 100, output: 0, cached: 0, reasoning: 0 }).cost_usd).toBe(0.001);
    fs.writeFileSync(file, `
[codex."codex-test"]
input = 20
output = 1
cached = 1
reasoning = 1
`);
    await waitForPrice(file, 0.002);
  });
});

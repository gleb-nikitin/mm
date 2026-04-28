import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'smol-toml';
import type { CostBreakdown, CostLineType, PricedUsage, PricingSource, TokenUsage, Vendor } from './types.ts';

type RateTable = Record<Vendor, Record<string, Partial<Record<CostLineType, number>>>>;

const DEFAULT_LINE_TYPES: CostLineType[] = ['input', 'output', 'cached', 'reasoning'];
const CLAUDE_LINE_TYPES: CostLineType[] = ['input', 'output', 'cache_creation_5m', 'cache_creation_1h', 'cache_read', 'reasoning'];
const RATE_TYPES: CostLineType[] = ['input', 'output', 'cached', 'reasoning', 'cache_creation_5m', 'cache_creation_1h', 'cache_read'];
const DEFAULT_PRICING_PATH = path.resolve(new URL('../../pricing.toml', import.meta.url).pathname);

let pricingPath = DEFAULT_PRICING_PATH;
let table: RateTable | null = null;
let watcher: fs.FSWatcher | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let lastLoadFailed = false;
let initialized = false;

function emptyTable(): RateTable {
  return { claude: {}, codex: {}, gemini: {} };
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parsePricingToml(text: string): RateTable {
  const parsed = parse(text) as Record<string, unknown>;
  const out = emptyTable();
  for (const vendor of ['claude', 'codex', 'gemini'] as Vendor[]) {
    const vendorTable = parsed[vendor];
    if (!vendorTable || typeof vendorTable !== 'object' || Array.isArray(vendorTable)) continue;
    for (const [model, rates] of Object.entries(vendorTable as Record<string, unknown>)) {
      if (!rates || typeof rates !== 'object' || Array.isArray(rates)) continue;
      const modelRates: Partial<Record<CostLineType, number>> = {};
      for (const type of RATE_TYPES) {
        const n = asNumber((rates as Record<string, unknown>)[type]);
        if (n !== null) modelRates[type] = n;
      }
      out[vendor][model] = modelRates;
    }
  }
  return out;
}

function loadPricingNow(): void {
  const text = fs.readFileSync(pricingPath, 'utf-8');
  table = parsePricingToml(text);
  lastLoadFailed = false;
}

function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    try {
      loadPricingNow();
    } catch {
      lastLoadFailed = true;
    }
  }, 75);
}

function startWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  try {
    watcher = fs.watch(pricingPath, scheduleReload);
    (watcher as any).unref?.();
  } catch {
    // Missing pricing.toml is handled by the unknown-price fallback.
  }
}

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  try {
    loadPricingNow();
  } catch {
    table = emptyTable();
    lastLoadFailed = false;
  }
  startWatcher();
}

export function configurePricingFile(filePath: string, options: { watch?: boolean } = {}): void {
  pricingPath = filePath;
  initialized = true;
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  try {
    loadPricingNow();
  } catch {
    table = emptyTable();
    lastLoadFailed = false;
  }
  if (options.watch ?? true) startWatcher();
}

export function stopPricingWatcherForTests(): void {
  if (watcher) watcher.close();
  watcher = null;
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = null;
  pricingPath = DEFAULT_PRICING_PATH;
  table = null;
  lastLoadFailed = false;
  initialized = false;
}

function tokensForLine(usage: TokenUsage, type: CostLineType): number {
  if (type === 'cache_creation_5m') return usage.cache_creation_5m ?? 0;
  if (type === 'cache_creation_1h') return usage.cache_creation_1h ?? 0;
  if (type === 'cache_read') return usage.cache_read ?? usage.cached;
  return usage[type];
}

function lineTypesFor(vendor: Vendor, usage: TokenUsage): CostLineType[] {
  if (vendor === 'claude') {
    return CLAUDE_LINE_TYPES;
  }
  return DEFAULT_LINE_TYPES;
}

function unknownBreakdown(vendor: Vendor, model: string | null, usage: TokenUsage): PricedUsage {
  const lineTypes = lineTypesFor(vendor, usage);
  return {
    cost_usd: null,
    cost_breakdown: {
      model,
      source: 'unknown',
      lines: lineTypes.map(type => ({
        type,
        tokens: tokensForLine(usage, type),
        rate: null,
        cost: null,
      })),
    },
  };
}

function lineCost(tokens: number, rate: number): number {
  return Number(((tokens * rate) / 1_000_000).toFixed(12));
}

export function priceUsage(vendor: Vendor, model: string | null, usage: TokenUsage): PricedUsage {
  ensureInitialized();
  if (!model) return unknownBreakdown(vendor, model, usage);
  const rates = table?.[vendor]?.[model];
  if (!rates) return unknownBreakdown(vendor, model, usage);
  const lines = lineTypesFor(vendor, usage).map(type => {
    const rate = rates[type];
    if (typeof rate !== 'number') {
      return { type, tokens: tokensForLine(usage, type), rate: null, cost: null };
    }
    const tokens = tokensForLine(usage, type);
    return { type, tokens, rate, cost: lineCost(tokens, rate) };
  });
  if (lines.some(line => line.rate === null || line.cost === null)) {
    return unknownBreakdown(vendor, model, usage);
  }
  const cost_usd = Number(lines.reduce((sum, line) => sum + (line.cost ?? 0), 0).toFixed(12));
  const source: PricingSource = lastLoadFailed ? 'stale' : 'pricing.toml';
  const cost_breakdown: CostBreakdown = { model, source, lines };
  return { cost_usd, cost_breakdown };
}

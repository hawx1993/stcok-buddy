import { describe, expect, it, vi } from 'vitest';
import type { MarketPageSnapshot, MarketQuoteRow } from '../../../../src/shared/types.js';
import { cacheMarketViewSnapshot, getCachedMarketViewState } from '../../../../src/components/market-view/market-view-snapshot-cache.js';

const marketDataStore = vi.hoisted(() => ({
  listDailyBars: vi.fn(),
  listLatestMarketRows: vi.fn(),
  listSecurities: vi.fn(),
  updateSecurityIndustries: vi.fn(),
}));
const quoteStore = vi.hoisted(() => ({
  getStoredQuoteRows: vi.fn(),
  upsertQuoteRows: vi.fn(),
}));
const industryProvider = vi.hoisted(() => ({
  loadSinaIndustryMap: vi.fn(),
}));
const marketState = vi.hoisted(() => ({
  marketIndexCache: new Map(),
}));
const marketIndices = vi.hoisted(() => ({
  fallbackIndex: vi.fn(),
  fallbackIndices: vi.fn(),
  getCachedMarketIndices: vi.fn(),
  getMarketIndices: vi.fn(),
}));
const shared = vi.hoisted(() => ({
  aggregateKlineByMonth: vi.fn(),
  aggregateKlineByWeek: vi.fn(),
  fetchEastmoneyClist: vi.fn(),
  fetchEastmoneyQuoteRowsByCodes: vi.fn(),
  hasValue: vi.fn((value: unknown) => value !== undefined && value !== null),
  mergeByCode: vi.fn((current: MarketQuoteRow[]) => current),
  normalizeIndustryName: vi.fn((value: string | undefined) => value?.trim() || undefined),
  parseMarketTime: vi.fn(),
  refreshQuoteCache: vi.fn(),
  shouldUseRemoteMarketData: vi.fn(),
  toMarketQuoteRow: vi.fn((row: MarketQuoteRow) => row),
  warnEastmoneyFallback: vi.fn(),
  withTimeoutReject: vi.fn(<T>(promise: Promise<T>) => promise),
  sdk: { board: { industry: { list: vi.fn(), constituents: vi.fn() } } },
}));

vi.mock('../../stock-db/market-data-store', () => marketDataStore);
vi.mock('../../stock-db/quote-store', () => quoteStore);
vi.mock('../industry-provider', () => industryProvider);
vi.mock('../market-state', () => marketState);
vi.mock('../market-indices', () => marketIndices);
vi.mock('../shared', () => shared);

import { getMarketPageSnapshot } from '../market-page.js';

const localRows: MarketQuoteRow[] = [
  {
    code: '600000',
    name: '浦发银行',
    price: 10,
    changePercent: 1,
    turnoverRate: 2,
    volume: 1000,
    amount: 10_000,
  },
];

function createSnapshot(rows: MarketQuoteRow[]): MarketPageSnapshot {
  return {
    tab: 'sh-main',
    period: '1d',
    updatedAt: '2026-08-20T06:00:00.000Z',
    indices: [],
    rows,
    boards: [],
    rowOrderSource: 'local',
  };
}

describe('市场页本地快照', () => {
  it('在行业补全仍进行时立即返回 DuckDB 本地快照', async () => {
    const pendingIndustryResult = new Promise<never>(() => undefined);
    marketDataStore.listDailyBars.mockResolvedValue([]);
    marketDataStore.listLatestMarketRows.mockResolvedValue(localRows);
    marketDataStore.listSecurities.mockResolvedValue([]);
    quoteStore.getStoredQuoteRows.mockReturnValue([]);
    marketIndices.fallbackIndex.mockImplementation((code: string) => ({ code, name: code, minutes: [] }));
    marketIndices.fallbackIndices.mockReturnValue([]);
    marketIndices.getCachedMarketIndices.mockResolvedValue([]);
    marketIndices.getMarketIndices.mockResolvedValue([]);
    shared.shouldUseRemoteMarketData.mockReturnValue(true);
    shared.refreshQuoteCache.mockResolvedValue([]);
    shared.fetchEastmoneyClist.mockReturnValue(pendingIndustryResult);
    shared.fetchEastmoneyQuoteRowsByCodes.mockReturnValue(pendingIndustryResult);
    industryProvider.loadSinaIndustryMap.mockReturnValue(pendingIndustryResult);

    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50));
    const snapshot = await Promise.race([getMarketPageSnapshot('sh-main'), timeout]);

    expect(snapshot).toMatchObject({ tab: 'sh-main', rows: localRows, rowOrderSource: 'local' });
  });

  it('retains the latest non-empty renderer snapshot for a remounted market view', () => {
    cacheMarketViewSnapshot(createSnapshot(localRows));
    cacheMarketViewSnapshot(createSnapshot([]));

    const cached = getCachedMarketViewState('sh-main', '1d');

    expect(cached.rowsByTab['sh-main']).toEqual(localRows);
    expect(cached.updatedAt).toBe('2026-08-20T06:00:00.000Z');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMarketDataSyncWorkerApi } from '../market-data-sync-worker-types.js';
import type { MarketDataSyncStatus } from '../types.js';

let workerApi: IMarketDataSyncWorkerApi | undefined;

const marketDataStoreMocks = vi.hoisted(() => ({
  clearSyncFailure: vi.fn(() => Promise.resolve()),
  countDailyBarsForDate: vi.fn(),
  createSyncJob: vi.fn(),
  getLatestTradeDate: vi.fn(),
  getResumableDailySyncJob: vi.fn(),
  listDailyBarCoverageCandidates: vi.fn(),
  listDailyBars: vi.fn(),
  listLatestSyncFailures: vi.fn(),
  listSecurities: vi.fn(),
  recordSyncFailure: vi.fn(() => Promise.resolve()),
  updateSyncJob: vi.fn(() => Promise.resolve()),
  upsertDailyBars: vi.fn(() => Promise.resolve()),
  upsertSecurities: vi.fn(),
  upsertTradingCalendar: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  listRemoteSecurities: vi.fn(),
  listRemoteTradingCalendar: vi.fn(),
  stockSdkHistoricalProvider: {
    getDailyBars: vi.fn(),
  },
}));

vi.mock('node:worker_threads', () => ({ parentPort: {} }));
vi.mock('comlink', () => ({
  expose: vi.fn((api: IMarketDataSyncWorkerApi) => {
    workerApi = api;
  }),
}));
vi.mock('../../stock/comlink-node-endpoint', () => ({ nodeEndpoint: vi.fn(() => ({})) }));
vi.mock('../../stock-db/market-data-store', () => marketDataStoreMocks);
vi.mock('../providers', () => providerMocks);
vi.mock('../quality', () => ({ partitionValidDailyBars: vi.fn(() => ({ valid: [], invalid: [] })) }));
vi.mock('../trade-date-resolver', () => ({ resolveTradingDate: vi.fn(() => Promise.resolve('2026-08-20')) }));
vi.mock('../market-data-sync-plan', () => ({
  INITIAL_YEARS: 10,
  RECENT_TRADING_DAYS: 30,
  dayAfter: vi.fn(() => '2026-01-01'),
  historicalBackfillRange: vi.fn(),
  isValidDateRange: vi.fn(),
  recentStartDate: vi.fn(),
  sortSecuritiesForSync: vi.fn(),
  splitSyncBatches: vi.fn(),
  yearsAgo: vi.fn(() => '2016-08-20'),
}));

async function loadWorkerApi() {
  await import('../market-data-sync.worker.js');
  if (!workerApi) throw new Error('market data sync worker API was not exposed');
  return workerApi;
}

afterEach(() => {
  workerApi = undefined;
  vi.clearAllMocks();
  vi.resetModules();
});

describe('market data sync worker retry', () => {
  it('reports remaining failed stocks instead of retry attempts', async () => {
    marketDataStoreMocks.listLatestSyncFailures.mockResolvedValue([
      { jobId: 'job-1', symbol: '000001', stage: 'daily-bars' },
      { jobId: 'job-1', symbol: '600519', stage: 'daily-bars' },
    ]);
    marketDataStoreMocks.listDailyBars.mockResolvedValue([]);
    marketDataStoreMocks.getLatestTradeDate.mockResolvedValue('2026-08-20');
    providerMocks.stockSdkHistoricalProvider.getDailyBars.mockImplementation(async (symbol: string) => {
      if (symbol === '000001') return [];
      throw new Error('provider unavailable');
    });
    const progress: MarketDataSyncStatus[] = [];
    const api = await loadWorkerApi();

    const result = await api.runRepair((status) => progress.push(status));

    expect(progress.slice(0, 3).map((status) => status.failedSymbols)).toEqual([2, 1, 1]);
    expect(result).toMatchObject({ state: 'partial', failedSymbols: 1 });
    expect(marketDataStoreMocks.clearSyncFailure).toHaveBeenCalledWith('job-1', '000001', 'daily-bars');
    expect(marketDataStoreMocks.recordSyncFailure).toHaveBeenCalledWith(
      'job-1',
      '600519',
      'daily-bars',
      'provider unavailable',
    );
    expect(marketDataStoreMocks.updateSyncJob).toHaveBeenLastCalledWith(
      'job-1',
      expect.objectContaining({ status: 'partial', failedSymbols: 1 }),
    );
  });
});

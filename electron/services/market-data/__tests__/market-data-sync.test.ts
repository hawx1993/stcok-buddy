import { describe, expect, it, vi } from 'vitest';
import type { SyncJobRecord } from '../types.js';

const marketDataStore = vi.hoisted(() => ({
  getLatestSyncJob: vi.fn(),
  getLatestTradeDate: vi.fn(),
  getMarketDataStats: vi.fn(),
}));

vi.mock('../../stock-db/market-data-store', () => marketDataStore);

vi.mock('../market-data-sync-worker-client', () => ({
  requestMarketDataWorkerStop: vi.fn(() => Promise.resolve()),
  retryMarketDataFailuresInWorker: vi.fn(),
  runHistoricalBackfillInWorker: vi.fn(),
  runMarketDataCoverageSyncInWorker: vi.fn(),
  runMarketDataSyncInWorker: vi.fn(),
}));

import { getMarketDataSyncStatus } from '../market-data-sync.js';

describe('market data sync status', () => {
  it('does not report a persisted running job as an active sync after restart', async () => {
    const runningJob: SyncJobRecord = {
      id: 'market-sync-1',
      status: 'running',
      state: 'syncing',
      jobType: 'initial_backfill',
      targetTradeDate: '2026-08-19',
      processedSymbols: 3500,
      totalSymbols: 5544,
      succeededSymbols: 2400,
      failedSymbols: 1215,
      startedAt: '2026-08-19T08:00:00.000Z',
    };
    marketDataStore.getLatestSyncJob.mockResolvedValue(runningJob);
    marketDataStore.getLatestTradeDate.mockResolvedValue('2026-08-19');

    await expect(getMarketDataSyncStatus()).resolves.toMatchObject({
      state: 'idle',
      processedSymbols: 0,
      totalSymbols: 0,
      failedSymbols: 1215,
      latestLocalTradeDate: '2026-08-19',
      message: '上次同步未完成，请点击立即同步继续',
    });
  });
});

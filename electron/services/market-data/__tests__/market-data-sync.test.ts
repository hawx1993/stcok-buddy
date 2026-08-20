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
      jobType: 'daily_incremental',
      targetTradeDate: '2026-08-19',
      processedSymbols: 3500,
      totalSymbols: 5544,
      succeededSymbols: 2400,
      failedSymbols: 1215,
      startedAt: '2026-08-19T08:00:00.000Z',
      checkpointAt: new Date(Date.now() - 60_000).toISOString(),
    };
    marketDataStore.getLatestSyncJob.mockResolvedValue(runningJob);
    marketDataStore.getLatestTradeDate.mockResolvedValue('2026-08-19');

    await expect(getMarketDataSyncStatus()).resolves.toMatchObject({
      state: 'idle',
      processedSymbols: 0,
      totalSymbols: 0,
      failedSymbols: 1215,
      latestLocalTradeDate: '2026-08-19',
      message: '上次同步未完成，点击立即同步将从检查点继续',
    });
  });

  it('marks interrupted daily sync checkpoints older than 24 hours as expired', async () => {
    const cancelledJob: SyncJobRecord = {
      id: 'market-sync-2',
      status: 'cancelled',
      state: 'idle',
      jobType: 'daily_incremental',
      targetTradeDate: '2026-08-19',
      processedSymbols: 120,
      totalSymbols: 5544,
      succeededSymbols: 120,
      failedSymbols: 0,
      startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      checkpointAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    marketDataStore.getLatestSyncJob.mockResolvedValue(cancelledJob);
    marketDataStore.getLatestTradeDate.mockResolvedValue('2026-08-19');

    await expect(getMarketDataSyncStatus()).resolves.toMatchObject({
      state: 'idle',
      message: '上次同步已超过 24 小时，本次将重新检查缺口',
    });
  });
});

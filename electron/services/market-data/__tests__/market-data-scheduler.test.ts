import { describe, expect, it, vi } from 'vitest';

const marketDataStore = vi.hoisted(() => ({
  initializeMarketDataStore: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../stock-db/market-data-store', () => marketDataStore);

const marketDataSync = vi.hoisted(() => ({
  requestMarketDataSyncStop: vi.fn(),
  startMarketDataSync: vi.fn(() => Promise.resolve()),
  waitForMarketDataSync: vi.fn(() => Promise.resolve()),
}));

const workerClient = vi.hoisted(() => ({
  disposeMarketDataSyncWorker: vi.fn(() => Promise.resolve()),
}));

vi.mock('../market-data-sync', () => marketDataSync);
vi.mock('../market-data-sync-worker-client', () => workerClient);

import { ensureMarketDataRuntime, shutdownMarketDataScheduler } from '../market-data-scheduler.js';

describe('市场数据运行时', () => {
  it('只初始化本地库，不自动启动同步', async () => {
    vi.useFakeTimers();
    try {
      await ensureMarketDataRuntime();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(marketDataStore.initializeMarketDataStore).toHaveBeenCalledTimes(1);
      expect(marketDataSync.startMarketDataSync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('退出调度器时会等待 worker 释放', async () => {
    await shutdownMarketDataScheduler();

    expect(workerClient.disposeMarketDataSyncWorker).toHaveBeenCalledTimes(1);
  });
});

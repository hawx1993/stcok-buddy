import { describe, expect, it, vi } from 'vitest';

const stats = vi.hoisted(() => ({
  dailyBarCount: 0,
  latestTradeDate: undefined as string | undefined,
}));

vi.mock('../market-data-store.js', () => ({
  getMarketDataStats: vi.fn(() => Promise.resolve({
    securityCount: 0,
    dailyBarCount: stats.dailyBarCount,
    latestTradeDate: stats.latestTradeDate,
    databaseBytes: 0,
    failedSymbols: 0,
  })),
  initializeMarketDataStore: vi.fn(() => Promise.resolve()),
}));

vi.mock('../market-data-sync.js', () => ({
  requestMarketDataSyncStop: vi.fn(),
  startMarketDataSync: vi.fn(() => Promise.resolve()),
  waitForMarketDataSync: vi.fn(() => Promise.resolve()),
}));

import { shouldAutoSyncMarketDataForTest } from '../market-data-scheduler.js';

describe('市场数据自动同步调度器', () => {
  it('本地没有日K数据时需要自动同步', async () => {
    stats.dailyBarCount = 0;
    stats.latestTradeDate = undefined;

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(true);
  });

  it('本地有日K数据但没有最新日期时需要自动同步', async () => {
    stats.dailyBarCount = 100;
    stats.latestTradeDate = undefined;

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(true);
  });

  it('本地最新日K在31天内时不自动同步', async () => {
    stats.dailyBarCount = 100;
    stats.latestTradeDate = '2026-07-20';

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(false);
  });

  it('本地最新日K超过31天时需要自动同步', async () => {
    stats.dailyBarCount = 100;
    stats.latestTradeDate = '2026-06-01';

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(true);
  });
});

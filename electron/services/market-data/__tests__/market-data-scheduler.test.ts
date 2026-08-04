import { describe, expect, it, vi } from 'vitest';

const latestJob = vi.hoisted(() => ({
  value: undefined as
    | { targetTradeDate?: string; succeededSymbols: number }
    | undefined,
}));

vi.mock('../market-data-store.js', () => ({
  getLatestSyncJob: vi.fn(() => Promise.resolve(latestJob.value)),
  initializeMarketDataStore: vi.fn(() => Promise.resolve()),
}));

vi.mock('../market-data-sync.js', () => ({
  requestMarketDataSyncStop: vi.fn(),
  startMarketDataSync: vi.fn(() => Promise.resolve()),
  waitForMarketDataSync: vi.fn(() => Promise.resolve()),
}));

import { shouldAutoSyncMarketDataForTest } from '../market-data-scheduler.js';

describe('市场数据自动同步调度器', () => {
  it('没有历史同步记录时需要自动同步', async () => {
    latestJob.value = undefined;

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(true);
  });

  it('最近同步没有成功标的时需要自动同步', async () => {
    latestJob.value = { targetTradeDate: '2026-08-01', succeededSymbols: 0 };

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(true);
  });

  it('最近成功同步日期在31天内时不自动同步', async () => {
    latestJob.value = { targetTradeDate: '2026-07-20', succeededSymbols: 100 };

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(false);
  });

  it('最近成功同步日期超过31天时需要自动同步', async () => {
    latestJob.value = { targetTradeDate: '2026-06-01', succeededSymbols: 100 };

    await expect(shouldAutoSyncMarketDataForTest(new Date('2026-08-03T10:00:00+08:00'))).resolves.toBe(true);
  });
});

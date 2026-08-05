import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const marketTime = vi.hoisted(() => ({
  isChinaMarketOpen: vi.fn(() => true),
}));

const stockClient = vi.hoisted(() => ({
  listHotFocus: vi.fn(() => Promise.resolve([])),
}));

const surgeStore = vi.hoisted(() => ({
  flushSurgeSnapshotQueue: vi.fn(() => Promise.resolve()),
  pruneSurgeHistory: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../../src/shared/market-time.js', () => marketTime);
vi.mock('../stock-client.js', () => stockClient);
vi.mock('../surge-history-store.js', () => surgeStore);

type TSurgeHistoryScheduler = typeof import('../surge-history-scheduler.js');

async function loadScheduler(): Promise<TSurgeHistoryScheduler> {
  vi.resetModules();
  surgeStore.flushSurgeSnapshotQueue.mockClear();
  surgeStore.pruneSurgeHistory.mockClear();
  stockClient.listHotFocus.mockClear();
  marketTime.isChinaMarketOpen.mockReturnValue(true);
  return import('../surge-history-scheduler.js');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('异动历史调度器退出清理', () => {
  it('普通 stop 后仍允许重新启动调度器', async () => {
    const scheduler = await loadScheduler();

    scheduler.ensureSurgeHistoryCapture();
    scheduler.stopSurgeHistoryScheduler();
    scheduler.ensureSurgeHistoryCapture();

    expect(scheduler.isSurgeHistorySchedulerRunning()).toBe(true);
    scheduler.stopSurgeHistoryScheduler();
  });

  it('shutdown 后阻止后台调度器被重新拉起', async () => {
    const scheduler = await loadScheduler();

    scheduler.shutdownSurgeHistoryScheduler();
    scheduler.ensureSurgeHistoryCapture();

    expect(scheduler.isSurgeHistorySchedulerRunning()).toBe(false);
  });

  it('退出等待可以跳过额外队列 flush', async () => {
    const scheduler = await loadScheduler();

    await scheduler.waitForSurgeHistoryScheduler({ flushQueued: false, timeoutMs: 10 });

    expect(surgeStore.flushSurgeSnapshotQueue).not.toHaveBeenCalled();
  });

  it('默认等待保持原有 flush 队列语义', async () => {
    const scheduler = await loadScheduler();

    await scheduler.waitForSurgeHistoryScheduler();

    expect(surgeStore.flushSurgeSnapshotQueue).toHaveBeenCalledTimes(1);
  });
});

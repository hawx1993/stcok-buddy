import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const marketTime = vi.hoisted(() => ({
  isChinaMarketOpen: vi.fn(() => true),
}));

const monitorStore = vi.hoisted(() => ({
  flushMonitorEventQueue: vi.fn(() => Promise.resolve()),
}));

const monitorService = vi.hoisted(() => ({
  captureMonitorEvents: vi.fn(() => Promise.resolve([])),
  persistMonitorCapture: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../../src/shared/market-time.js', () => marketTime);
vi.mock('../monitor-history-store.js', () => monitorStore);
vi.mock('../monitor-service.js', () => monitorService);

type TMonitorHistoryScheduler = typeof import('../monitor-history-scheduler.js');

async function loadScheduler(): Promise<TMonitorHistoryScheduler> {
  vi.resetModules();
  monitorStore.flushMonitorEventQueue.mockClear();
  monitorService.captureMonitorEvents.mockClear();
  monitorService.persistMonitorCapture.mockClear();
  marketTime.isChinaMarketOpen.mockReturnValue(true);
  return import('../monitor-history-scheduler.js');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AI 监控历史调度器退出清理', () => {
  it('stop 会清理 capture 和 flush 定时器', async () => {
    const scheduler = await loadScheduler();

    scheduler.startMonitorHistoryScheduler();
    expect(scheduler.isMonitorHistorySchedulerRunning()).toBe(true);

    scheduler.stopMonitorHistoryScheduler();

    expect(scheduler.isMonitorHistorySchedulerRunning()).toBe(false);
  });

  it('退出等待可以跳过额外队列 flush', async () => {
    const scheduler = await loadScheduler();

    await scheduler.waitForMonitorHistoryScheduler({ flushQueued: false, timeoutMs: 10 });

    expect(monitorStore.flushMonitorEventQueue).not.toHaveBeenCalled();
  });

  it('默认等待保持原有 flush 队列语义', async () => {
    const scheduler = await loadScheduler();

    await scheduler.waitForMonitorHistoryScheduler();

    expect(monitorStore.flushMonitorEventQueue).toHaveBeenCalledTimes(1);
  });
});

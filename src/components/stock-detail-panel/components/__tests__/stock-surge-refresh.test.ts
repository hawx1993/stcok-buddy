import { describe, expect, it, vi } from 'vitest';
import type { StockSurgeEvent } from '../../../../shared/types';
import { createStockSurgePoller } from '../stock-surge-refresh';

const event: StockSurgeEvent = { id: 'event-1', title: '异动', tradeDate: '2026-08-12' };

describe('createStockSurgePoller', () => {
  it('每 30 秒请求一次并在停止后清理定时器', async () => {
    const callbacks: Array<() => void> = [];
    const clearIntervalFn = vi.fn();
    const onItems = vi.fn();
    const load = vi.fn().mockResolvedValue([event]);
    const poller = createStockSurgePoller({
      load,
      onItems,
      onError: vi.fn(),
      setIntervalFn: (callback, milliseconds) => {
        expect(milliseconds).toBe(30_000);
        callbacks.push(callback);
        return 1;
      },
      clearIntervalFn,
    });

    callbacks[0]?.();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onItems).toHaveBeenCalledWith([event]);

    poller.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(1);
  });

  it('不重叠请求且停止后忽略延迟响应', async () => {
    const callbacks: Array<() => void> = [];
    const resolvers: Array<(items: StockSurgeEvent[]) => void> = [];
    const onItems = vi.fn();
    const load = vi.fn(() => new Promise<StockSurgeEvent[]>((resolve) => resolvers.push(resolve)));
    const poller = createStockSurgePoller({
      load,
      onItems,
      onError: vi.fn(),
      setIntervalFn: (callback) => {
        callbacks.push(callback);
        return 2;
      },
      clearIntervalFn: vi.fn(),
    });

    callbacks[0]?.();
    callbacks[0]?.();
    expect(load).toHaveBeenCalledTimes(1);

    poller.stop();
    resolvers[0]?.([event]);
    await Promise.resolve();
    expect(onItems).not.toHaveBeenCalled();
  });
});

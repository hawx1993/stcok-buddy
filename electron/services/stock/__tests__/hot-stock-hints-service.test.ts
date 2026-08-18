import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHotStockHintSource } from '../../../../src/shared/types.js';

const mocks = vi.hoisted(() => ({
  getLatestHotStockHintSnapshot: vi.fn(),
  saveHotStockHintSnapshot: vi.fn(),
  isRemoteTradingDay: vi.fn(),
  previousRemoteTradingDay: vi.fn(),
  listHotFocus: vi.fn(),
  listSurgeHistoryWithBackfill: vi.fn(),
}));

vi.mock('../../stock-db/quote-store', () => ({
  getLatestHotStockHintSnapshot: mocks.getLatestHotStockHintSnapshot,
  saveHotStockHintSnapshot: mocks.saveHotStockHintSnapshot,
}));

vi.mock('../../market-data/providers', () => ({
  isRemoteTradingDay: mocks.isRemoteTradingDay,
  previousRemoteTradingDay: mocks.previousRemoteTradingDay,
}));

vi.mock('../stock-client', () => ({
  listHotFocus: mocks.listHotFocus,
}));

vi.mock('../surge-history-service', () => ({
  listSurgeHistoryWithBackfill: mocks.listSurgeHistoryWithBackfill,
}));

type THotStockHintsService = typeof import('../hot-stock-hints-service.js');

let service: THotStockHintsService | undefined;

function source(overrides: Partial<IHotStockHintSource> = {}): IHotStockHintSource {
  return {
    items: [
      {
        id: 'hot-600519',
        title: '贵州茅台 600519',
        code: '600519',
        name: '贵州茅台',
        tag: '封涨停板',
        type: 'surge',
      },
    ],
    tradeDate: '2026-08-18',
    isPreviousTradeDay: false,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getLatestHotStockHintSnapshot.mockReturnValue(undefined);
  mocks.isRemoteTradingDay.mockResolvedValue(true);
  mocks.listHotFocus.mockImplementation((tab: string) => Promise.resolve(tab === 'surge' ? source().items : []));
  service = await import('../hot-stock-hints-service.js');
});

describe('今日热点本地快照', () => {
  it('缓存命中时立即返回 SQLite 数据且不访问真实来源', async () => {
    mocks.getLatestHotStockHintSnapshot.mockReturnValue({
      cacheDate: '2026-08-18',
      source: source(),
      updatedAt: '2026-08-18T01:00:00.000Z',
    });
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    const result = await currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'));

    expect(result).toEqual({ source: source(), refresh: undefined });
    expect(mocks.isRemoteTradingDay).not.toHaveBeenCalled();
    expect(mocks.listHotFocus).not.toHaveBeenCalled();
  });

  it('过期缓存先返回旧真实数据，并合并为一次后台刷新', async () => {
    mocks.getLatestHotStockHintSnapshot.mockReturnValue({
      cacheDate: '2026-08-17',
      source: source({ tradeDate: '2026-08-15', isPreviousTradeDay: false }),
      updatedAt: '2026-08-17T01:00:00.000Z',
    });
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');
    const now = new Date('2026-08-18T02:00:00.000Z');

    const first = await currentService.getHotStockHintSource(now);
    const second = await currentService.getHotStockHintSource(now);

    expect(first.source).toMatchObject({ tradeDate: '2026-08-15', isPreviousTradeDay: true });
    expect(first.refresh).toBe(second.refresh);
    await expect(first.refresh).resolves.toEqual(source());
    expect(mocks.listHotFocus).toHaveBeenCalledTimes(2);
    expect(mocks.saveHotStockHintSnapshot).toHaveBeenCalledWith('2026-08-18', source());
  });

  it('没有缓存时读取真实来源并持久化完整快照', async () => {
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    await expect(currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'))).resolves.toEqual({
      source: source(),
    });
    expect(mocks.saveHotStockHintSnapshot).toHaveBeenCalledWith('2026-08-18', source());
  });

  it('没有缓存且真实来源失败时向调用方暴露错误', async () => {
    mocks.listHotFocus.mockRejectedValue(new Error('stock-sdk unavailable'));
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    await expect(currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'))).rejects.toThrow(
      'stock-sdk unavailable',
    );
    expect(mocks.saveHotStockHintSnapshot).not.toHaveBeenCalled();
  });
});

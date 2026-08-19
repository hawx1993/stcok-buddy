import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHotStockHintSource } from '../../../../src/shared/types.js';

const mocks = vi.hoisted(() => ({
  getLatestHotStockHintSnapshot: vi.fn(),
  saveHotStockHintSnapshot: vi.fn(),
  isRemoteTradingDay: vi.fn(),
  previousRemoteTradingDay: vi.fn(),
  listHotFocus: vi.fn(),
  listSurgeHistoryWithBackfill: vi.fn(),
  ztPool: vi.fn(),
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

vi.mock('../shared', () => ({
  sdk: { marketEvent: { ztPool: mocks.ztPool } },
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
  mocks.previousRemoteTradingDay.mockImplementation((date: string) => {
    const dates: Record<string, string> = {
      '2026-08-18': '2026-08-17',
      '2026-08-17': '2026-08-14',
      '2026-08-14': '2026-08-13',
      '2026-08-13': '2026-08-12',
    };
    return Promise.resolve(dates[date] ?? '2026-08-11');
  });
  mocks.listHotFocus.mockImplementation((tab: string) => Promise.resolve(tab === 'surge' ? source().items : []));
  mocks.listSurgeHistoryWithBackfill.mockResolvedValue([]);
  mocks.ztPool.mockResolvedValue([]);
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

  it('同日空缓存立即返回空态并触发后台刷新', async () => {
    mocks.getLatestHotStockHintSnapshot.mockReturnValue({
      cacheDate: '2026-08-18',
      source: source({ items: [] }),
      updatedAt: '2026-08-18T01:00:00.000Z',
    });
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    const result = await currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'));

    expect(result.source.items).toEqual([]);
    await expect(result.refresh).resolves.toEqual(source());
    expect(mocks.listHotFocus).toHaveBeenCalledTimes(2);
    expect(mocks.saveHotStockHintSnapshot).toHaveBeenCalledWith('2026-08-18', source());
  });

  it('同日仅含板块代码的缓存按空态处理并触发后台刷新', async () => {
    mocks.getLatestHotStockHintSnapshot.mockReturnValue({
      cacheDate: '2026-08-18',
      source: source({
        items: [{ id: 'board-BK0800', title: '人工智能', code: 'BK0800', name: '人工智能' }],
      }),
      updatedAt: '2026-08-18T01:00:00.000Z',
    });
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    const result = await currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'));

    expect(result.source.items).toEqual([]);
    await expect(result.refresh).resolves.toEqual(source());
    expect(mocks.listHotFocus).toHaveBeenCalledTimes(2);
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

  it('交易日历不可用时仍使用当日真实涨停池', async () => {
    mocks.isRemoteTradingDay.mockRejectedValue(new Error('交易日历不可用'));
    mocks.previousRemoteTradingDay.mockRejectedValue(new Error('上一交易日不可用'));
    mocks.listHotFocus.mockRejectedValue(new Error('当日热点不可用'));
    mocks.ztPool.mockResolvedValue([
      {
        code: '600313',
        name: '农发种业',
        totalMarketValue: 8_000_000_000,
        continuousBoardCount: 3,
        ztStatistics: '3/3',
      },
    ]);
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    await expect(currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'))).resolves.toMatchObject({
      source: {
        items: [expect.objectContaining({ code: '600313', name: '农发种业' })],
        tradeDate: '2026-08-18',
        isPreviousTradeDay: false,
      },
    });
    expect(mocks.saveHotStockHintSnapshot).toHaveBeenCalledWith(
      '2026-08-18',
      expect.objectContaining({ tradeDate: '2026-08-18', isPreviousTradeDay: false }),
    );
  });

  it('一个当日热点来源失败时仍使用另一个真实来源', async () => {
    mocks.listHotFocus.mockImplementation((tab: string) => (
      tab === 'surge'
        ? Promise.resolve(source().items)
        : Promise.reject(new Error('板块热点不可用'))
    ));
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    await expect(currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'))).resolves.toEqual({
      source: source(),
    });
    expect(mocks.saveHotStockHintSnapshot).toHaveBeenCalledWith('2026-08-18', source());
  });

  it('没有缓存且所有真实来源失败时向调用方暴露错误', async () => {
    mocks.listHotFocus.mockRejectedValue(new Error('stock-sdk unavailable'));
    mocks.listSurgeHistoryWithBackfill.mockRejectedValue(new Error('历史异动不可用'));
    mocks.ztPool.mockRejectedValue(new Error('涨停池不可用'));
    const currentService = service;
    if (!currentService) throw new Error('热点服务未初始化');

    await expect(currentService.getHotStockHintSource(new Date('2026-08-18T02:00:00.000Z'))).rejects.toThrow(
      /热点数据源暂不可用：stock-sdk unavailable；历史异动不可用/,
    );
    expect(mocks.saveHotStockHintSnapshot).not.toHaveBeenCalled();
  });
});

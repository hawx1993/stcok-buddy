import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  individualChangesHistory: vi.fn(),
  stockChanges: vi.fn(),
  isRemoteTradingDay: vi.fn(),
  previousRemoteTradingDay: vi.fn(),
  listBoardConstituents: vi.fn(),
  listLatestMarketRows: vi.fn(),
  listMarketBoards: vi.fn(),
  getBoardDetail: vi.fn(),
  isSurgeHistoryClearMarkerActive: vi.fn(),
  listRecentStockSurgeEvents: vi.fn(),
  listSurgeHistory: vi.fn(),
  enqueueSurgeSnapshot: vi.fn(),
  saveIndividualSurgeHistory: vi.fn(),
  setSurgeHistoryClearMarker: vi.fn(),
}));

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    marketEvent = {
      individualChangesHistory: mocks.individualChangesHistory,
      stockChanges: mocks.stockChanges,
    };

    board = {
      industry: { list: vi.fn() },
      concept: { list: vi.fn() },
    };

    fundFlow = {
      sectorRank: vi.fn(),
      market: vi.fn(),
      rank: vi.fn(),
    };
  },
}));

vi.mock('../../market-data/providers.js', () => ({
  isRemoteTradingDay: mocks.isRemoteTradingDay,
  previousRemoteTradingDay: mocks.previousRemoteTradingDay,
}));

vi.mock('../../market-data/market-data-store.js', () => ({
  listBoardConstituents: mocks.listBoardConstituents,
  listLatestMarketRows: mocks.listLatestMarketRows,
  listMarketBoards: mocks.listMarketBoards,
}));

vi.mock('../board-detail.js', () => ({
  getBoardDetail: mocks.getBoardDetail,
}));

vi.mock('../surge-history-store.js', () => ({
  isSurgeHistoryClearMarkerActive: mocks.isSurgeHistoryClearMarkerActive,
  listRecentStockSurgeEvents: mocks.listRecentStockSurgeEvents,
  listSurgeHistory: mocks.listSurgeHistory,
  enqueueSurgeSnapshot: mocks.enqueueSurgeSnapshot,
  saveIndividualSurgeHistory: mocks.saveIndividualSurgeHistory,
  setSurgeHistoryClearMarker: mocks.setSurgeHistoryClearMarker,
}));

import { clearSurgeCache, listStockSurgeEvents } from '../hot-focus.js';

describe('listStockSurgeEvents 个股详情最近一周异动', () => {
  const localEvent = {
    id: 'local-2026-08-07-600519',
    title: '贵州茅台 600519',
    code: '600519',
    name: '贵州茅台',
    tradeDate: '2026-08-07',
    time: '10:01:00',
    tag: '快速涨幅',
    type: 'surge' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { pool: [] } }),
      }),
    );
    mocks.isSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mocks.listRecentStockSurgeEvents.mockResolvedValue([]);
    mocks.individualChangesHistory.mockResolvedValue({ name: '贵州茅台', days: [] });
    mocks.saveIndividualSurgeHistory.mockResolvedValue(undefined);
    mocks.stockChanges.mockResolvedValue([]);
    mocks.isRemoteTradingDay.mockResolvedValue(true);
    clearSurgeCache();
    vi.clearAllMocks();
    mocks.isSurgeHistoryClearMarkerActive.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('本地 DuckDB 有数据时立即返回本地记录', async () => {
    mocks.listRecentStockSurgeEvents.mockResolvedValue([localEvent]);

    await expect(listStockSurgeEvents('600519')).resolves.toEqual([localEvent]);

    expect(mocks.listRecentStockSurgeEvents).toHaveBeenCalledWith('600519', 7);
    expect(mocks.individualChangesHistory).toHaveBeenCalledWith('600519', { days: 6 });
  });

  it('本地 DuckDB 无数据时直接走 stock-sdk 个股异动历史，不先等待交易日解析', async () => {
    mocks.individualChangesHistory.mockResolvedValue({
      name: '贵州茅台',
      days: [
        {
          date: '2026-08-07',
          available: true,
          changes: [
            {
              typeCode: '8193',
              time: '10:01:00',
              changeType: 'large_buy',
              changeTypeLabel: '大笔买入',
              info: '1000000,1500,1.23,120000000',
              price: 1500,
              changePercent: 1.23,
            },
          ],
        },
      ],
    });

    const rows = await listStockSurgeEvents('600519');

    expect(mocks.listRecentStockSurgeEvents).toHaveBeenCalledWith('600519', 7);
    expect(mocks.individualChangesHistory).toHaveBeenCalledWith('600519', { days: 6 });
    expect(mocks.previousRemoteTradingDay).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({
        code: '600519',
        tradeDate: '2026-08-07',
        tag: '特大单买入',
        amount: '买入1万手',
      }),
    ]);
    expect(mocks.saveIndividualSurgeHistory).toHaveBeenCalledWith(rows);
  });

  it('个股异动历史为空时可返回真实当日异动匹配记录', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T10:00:00+08:00'));
    mocks.stockChanges.mockResolvedValue([
      {
        code: '600519',
        name: '贵州茅台',
        time: '10:02:00',
        changeType: 'rocket_launch',
        changeTypeLabel: '快速拉升',
        info: '0,1500,2.4',
      },
    ]);

    const rows = await listStockSurgeEvents('600519');
    const expectedTradeDate = new Date().toLocaleDateString('en-CA');

    expect(rows).toEqual([
      expect.objectContaining({
        code: '600519',
        tradeDate: expectedTradeDate,
        tag: '快速涨幅',
        changePercent: '+2.40%',
      }),
    ]);
    expect(mocks.saveIndividualSurgeHistory).not.toHaveBeenCalled();
  });

  it('真实来源都没有数据时返回空数组', async () => {
    await expect(listStockSurgeEvents('600519')).resolves.toEqual([]);
    expect(mocks.saveIndividualSurgeHistory).not.toHaveBeenCalled();
  });
});

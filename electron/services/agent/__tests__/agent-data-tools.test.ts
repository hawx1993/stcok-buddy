import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChipDistribution: vi.fn(),
  getStockChip: vi.fn(),
  listStockSurgeEvents: vi.fn(),
  runAStockDataFn: vi.fn(),
}));

vi.mock('../../market-data/market-data-sync.js', () => ({
  getMarketDataSyncStatus: vi.fn(),
}));

vi.mock('../../market-data/market-data-query.js', () => ({
  queryHistoricalBars: vi.fn(),
  queryLatestQuote: vi.fn(),
}));

vi.mock('../../market-data/market-data-store.js', () => ({
  getLatestDailyBar: vi.fn(),
  getStockChip: mocks.getStockChip,
  listDailyBars: vi.fn(),
  listLatestMarketRows: vi.fn(),
}));

vi.mock('../../market-data/providers.js', () => ({
  remoteMarketStatus: vi.fn(() => 'closed'),
}));

vi.mock('../../stock/stock-client.js', () => ({
  getChipDistribution: mocks.getChipDistribution,
  getStockFundFlowSnapshot: vi.fn(),
  listStockSurgeEvents: mocks.listStockSurgeEvents,
}));

vi.mock('../../stock/a-stock-data-runner.js', () => ({
  runAStockDataFn: mocks.runAStockDataFn,
}));

import type { IChipDistributionResult, StockSurgeEvent } from '../../../../src/shared/types.js';
import { getStockChipDistributionLocalFirst, getStockSurgeEventsLocalFirst } from '../agent-data-tools.js';

const localEvent: StockSurgeEvent = {
  id: 'local-1',
  tradeDate: '2026-08-05',
  title: '本地异动',
  code: '600519',
  description: '特大单买入',
  tag: '特大单买入',
};

function createChipResult(source: IChipDistributionResult['source']): IChipDistributionResult {
  return {
    latest: {
      date: '2026-08-05',
      concentration90: 0.18,
      concentration70: 0.12,
      profitRatio: 0.66,
      points: [{ price: 10, weight: 1 }],
    },
    distributions: [
      { date: '2026-08-01', concentration90: 0.22, concentration70: 0.14, points: [{ price: 9.8, weight: 1 }] },
      { date: '2026-08-04', concentration90: 0.19, concentration70: 0.13, points: [{ price: 10.2, weight: 1 }] },
      { date: '2026-08-05', concentration90: 0.18, concentration70: 0.12, points: [{ price: 10, weight: 1 }] },
    ],
    trend: [{ days: 5, concentration90: 0.18, concentration70: 0.12 }],
    source,
  };
}

describe('getStockChipDistributionLocalFirst 个股筹码本地优先工具', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('本地 DuckDB 有筹码缓存时直接返回最近筹码集中度', async () => {
    mocks.getStockChip.mockResolvedValueOnce(createChipResult('stock-sdk'));

    const result = await getStockChipDistributionLocalFirst.run({ symbol: '600519', days: 2 });

    expect(result).toMatchObject({ source: 'duckdb:market', storage: 'local', symbol: '600519', isEmpty: false });
    expect(result.latest?.concentration90).toBe(0.18);
    expect(result.latest?.concentration70).toBe(0.12);
    expect(result.recent.map((item) => item.date)).toEqual(['2026-08-04', '2026-08-05']);
    expect(mocks.getChipDistribution).not.toHaveBeenCalled();
  });

  it('本地 DuckDB 无筹码缓存时调用 stock-sdk / a-stock-data 链路补齐', async () => {
    mocks.getStockChip.mockResolvedValueOnce(undefined);
    mocks.getChipDistribution.mockResolvedValueOnce(createChipResult('a-stock-data'));

    const result = await getStockChipDistributionLocalFirst.run({ symbol: '600519', days: 5 });

    expect(result).toMatchObject({ source: 'a-stock-data', storage: 'remote', symbol: '600519', isEmpty: false });
    expect(result.warnings[0]).toContain('本地 DuckDB 暂无该股票筹码缓存');
    expect(result.recent).toHaveLength(3);
    expect(mocks.getChipDistribution).toHaveBeenCalledWith('600519');
  });
});

describe('getStockSurgeEventsLocalFirst 个股异动本地优先工具', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('右侧栏同源服务有数据时直接返回最近个股异动', async () => {
    mocks.listStockSurgeEvents.mockResolvedValueOnce([localEvent]);

    const result = await getStockSurgeEventsLocalFirst.run({ symbol: '600519', days: 7, limit: 200 });

    expect(result).toMatchObject({ source: 'right-panel-local-first', storage: 'local', symbol: '600519', isEmpty: false });
    expect(result.rows).toEqual([localEvent]);
    expect(mocks.listStockSurgeEvents).toHaveBeenCalledWith('600519');
    expect(mocks.runAStockDataFn).not.toHaveBeenCalled();
  });

  it('复用右侧栏同源服务返回昨天和前天的个股异动', async () => {
    const historyEvents: StockSurgeEvent[] = [
      { ...localEvent, id: 'yesterday-1', tradeDate: '2026-08-04', amount: '买入1.2万手' },
      { ...localEvent, id: 'previous-1', tradeDate: '2026-08-03', amount: '买入1.1万手' },
    ];
    mocks.listStockSurgeEvents.mockResolvedValueOnce(historyEvents);

    const result = await getStockSurgeEventsLocalFirst.run({ symbol: '600519', days: 7, limit: 200 });

    expect(result.rows.map((item) => item.tradeDate)).toEqual(['2026-08-04', '2026-08-03']);
    expect(mocks.runAStockDataFn).not.toHaveBeenCalled();
  });

  it('右侧栏同源服务为空时调用 a-stock-data 逐笔成交兜底', async () => {
    mocks.listStockSurgeEvents.mockResolvedValueOnce([]);
    mocks.runAStockDataFn.mockResolvedValueOnce([
      { time: '10:01', price: 10.8, vol: 12000, num: 3, buyorsell: 0 },
    ]);

    const result = await getStockSurgeEventsLocalFirst.run({ symbol: '600519', minHands: 10000 });

    expect(result).toMatchObject({ source: 'a-stock-data', storage: 'remote', symbol: '600519', isEmpty: false });
    expect(result.rows[0]).toMatchObject({ code: '600519', amount: '买入1.20万手', tag: '特大单买入' });
    expect(mocks.runAStockDataFn).toHaveBeenCalledWith('tdx_transactions', expect.objectContaining({ code: '600519', min_hands: 10000 }));
  });
});

import os from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.STOCKSENSE_MARKET_DB_PATH = `${process.env.TMPDIR ?? '/tmp'}/stocksense-condition-screener-${process.pid}.duckdb`;
});

const sharedMocks = vi.hoisted(() => ({
  getCachedMarketBoardRows: vi.fn(),
  refreshMarketBoardRows: vi.fn(),
}));

vi.mock('electron', () => {
  const electron = {
    app: {
      getPath: () => os.tmpdir(),
      isPackaged: false,
    },
  };
  return { ...electron, default: electron };
});

vi.mock('../../../electron-runtime', () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

vi.mock('../../stock/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stock/shared.js')>()),
  getCachedMarketBoardRows: sharedMocks.getCachedMarketBoardRows,
  refreshMarketBoardRows: sharedMocks.refreshMarketBoardRows,
}));

import {
  resetConditionScreenerDependenciesForTest,
  screenASharesByConditions,
  setConditionScreenerDependenciesForTest,
} from '../condition-screener-service.js';
import type { IChipDistributionResult, MarketBoardRow } from '../../../../src/shared/types.js';
import type { IAShareMarketCapSnapshotRow } from '../../stock-db/market-data-store.js';
import type { MarketBoardRecord, StockChipCacheRecord } from '../types.js';

type TConditionScreenerDependencyOverrides = Parameters<typeof setConditionScreenerDependenciesForTest>[0];

function row(
  partial: Partial<IAShareMarketCapSnapshotRow> & Pick<IAShareMarketCapSnapshotRow, 'symbol' | 'name'>,
): IAShareMarketCapSnapshotRow {
  return {
    exchange: partial.symbol.startsWith('6') ? 'SH' : 'SZ',
    isSt: false,
    ...partial,
  };
}

function chipResult(concentration90: number, profitRatio: number, concentration70 = 0.08): IChipDistributionResult {
  return {
    latest: {
      date: '2026-08-17',
      concentration90,
      concentration70,
      profitRatio,
      points: [{ price: 10, weight: 1 }],
    },
    distributions: [],
    trend: [],
    source: 'stock-sdk',
  };
}

function chip(
  symbol: string,
  concentration90: number,
  profitRatio: number,
  concentration70 = 0.08,
): StockChipCacheRecord {
  return {
    symbol,
    fetchedAt: '2026-08-17T09:30:00.000Z',
    data: chipResult(concentration90, profitRatio, concentration70),
  };
}

function quoteFromRow(item: IAShareMarketCapSnapshotRow) {
  const totalMarketCap =
    item.totalMarketCap === undefined
      ? 50
      : item.totalMarketCap >= 100_000
        ? item.totalMarketCap / 100_000_000
        : item.totalMarketCap;
  const circulatingMarketCap =
    item.circulatingMarketCap === undefined
      ? undefined
      : item.circulatingMarketCap >= 100_000
        ? item.circulatingMarketCap / 100_000_000
        : item.circulatingMarketCap;
  return {
    code: item.symbol,
    name: item.name,
    exchange: item.exchange,
    price: item.price ?? 10,
    changePercent: item.changePercent ?? 0,
    volume: item.volume,
    turnoverRate: item.turnoverRate ?? 1,
    amount: item.amount ?? 10_000,
    totalMarketCap,
    circulatingMarketCap,
    fetchedAt: '2026-08-17T09:30:00.000Z',
  };
}

function configureDefaults(
  localRows: IAShareMarketCapSnapshotRow[],
  overrides: TConditionScreenerDependencyOverrides = {},
  useDefaultRemoteBoards = false,
) {
  const dependencyOverrides: TConditionScreenerDependencyOverrides = {
    listLocalRows: async () => localRows,
    listRemoteSecurities: async () => [],
    upsertSecurities: async () => undefined,
    upsertSnapshots: async () => undefined,
    fetchStockSdkAllQuotes: async () => ({ quotes: localRows.map(quoteFromRow), warnings: [] }),
    fetchAStockDataQuotes: async () => ({ quotes: [], warnings: [] }),
    listStockChips: async () => [],
    getChipDistribution: async () => {
      throw new Error('测试未配置筹码 provider');
    },
    listMarketBoards: async () => [],
    listBoardConstituents: async () => [],
    getBoardDetail: async (boardCode) => ({ code: boardCode, name: boardCode, kline: [], constituents: [] }),
    getMarketDataStats: async () => ({
      securityCount: localRows.length,
      dailyBarCount: 0,
      latestTradeDate: '2026-08-17',
      databaseBytes: 0,
      failedSymbols: 0,
    }),
    ...overrides,
  };
  if (!useDefaultRemoteBoards && dependencyOverrides.getRemoteBoards === undefined) {
    dependencyOverrides.getRemoteBoards = async () => [];
  }
  setConditionScreenerDependenciesForTest(dependencyOverrides);
}

beforeEach(() => {
  sharedMocks.getCachedMarketBoardRows.mockReset();
  sharedMocks.refreshMarketBoardRows.mockReset();
  sharedMocks.getCachedMarketBoardRows.mockResolvedValue([]);
  sharedMocks.refreshMarketBoardRows.mockResolvedValue([]);
});

afterEach(() => {
  resetConditionScreenerDependenciesForTest();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env.STOCKSENSE_MARKET_DB_PATH;
});

describe('条件选股真实数据服务', () => {
  it('按市值、换手率、成交额、涨幅和 ST 条件筛选并排序', async () => {
    configureDefaults([
      row({
        symbol: '600001',
        name: '高换手股',
        totalMarketCap: 50,
        turnoverRate: 12,
        amount: 30_000,
        changePercent: 5,
      }),
      row({
        symbol: '600002',
        name: '低换手股',
        totalMarketCap: 50,
        turnoverRate: 8,
        amount: 30_000,
        changePercent: 5,
      }),
      row({
        symbol: '600003',
        name: 'ST 样本',
        isSt: true,
        totalMarketCap: 50,
        turnoverRate: 18,
        amount: 50_000,
        changePercent: 5,
      }),
      row({
        symbol: '600004',
        name: '更高换手股',
        totalMarketCap: 50,
        turnoverRate: 16,
        amount: 50_000,
        changePercent: 6,
      }),
    ]);

    const result = await screenASharesByConditions({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
      changePercentMin: 3,
      changePercentMax: 8,
      excludeST: true,
      sortBy: 'turnoverRate',
      sortOrder: 'desc',
    });

    expect(result.rows.map((item) => item.code)).toEqual(['600004', '600001']);
    expect(result.rows.map((item) => item.amountYuan)).toEqual([500_000_000, 300_000_000]);
    expect(result.matchedCount).toBe(2);
    expect(result.storage).toBe('remote');
  });

  it('按流通市值、成交量、市场范围和 70% 筹码集中度筛选并排序', async () => {
    configureDefaults(
      [
        row({
          symbol: '600001',
          name: '沪市命中股',
          totalMarketCap: 80,
          circulatingMarketCap: 40,
          volume: 2_200_000,
          turnoverRate: 12,
          amount: 30_000,
        }),
        row({
          symbol: '600002',
          name: '流通市值过大股',
          totalMarketCap: 100,
          circulatingMarketCap: 80,
          volume: 2_500_000,
          turnoverRate: 14,
          amount: 35_000,
        }),
        row({
          symbol: '300001',
          name: '创业板样本',
          exchange: 'SZ',
          totalMarketCap: 60,
          circulatingMarketCap: 45,
          volume: 3_000_000,
          turnoverRate: 16,
          amount: 40_000,
        }),
      ],
      {
        listStockChips: async () => [
          chip('600001', 0.12, 0.6, 0.08),
          chip('600002', 0.12, 0.6, 0.08),
          chip('300001', 0.12, 0.6, 0.08),
        ],
      },
    );

    const result = await screenASharesByConditions({
      minCirculatingMarketCapYuan: 3_000_000_000,
      maxCirculatingMarketCapYuan: 5_000_000_000,
      volumeMinExclusive: 1_000_000,
      concentration70MaxExclusive: 10,
      marketScopes: ['sh'],
      sortBy: 'volume',
      sortOrder: 'desc',
    });

    expect(result.rows).toEqual([
      expect.objectContaining({
        code: '600001',
        volume: 2_200_000,
        circulatingMarketCapYuan: 4_000_000_000,
        concentration70Percent: 8,
      }),
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.sourceStats.missingChipData).toBe(0);
  });

  it('完整零命中时保留候选数据的存储层', async () => {
    configureDefaults([
      row({
        symbol: '600001',
        name: '未达换手门槛股',
        totalMarketCap: 50,
        turnoverRate: 8,
        amount: 30_000,
      }),
    ]);

    const result = await screenASharesByConditions({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
      excludeST: true,
    });

    expect(result.isComplete).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.storage).toBe('remote');
  });

  it('未指定排除 ST 时保留 ST 候选范围', async () => {
    const normal = row({ symbol: '600001', name: '普通股', price: 10 });
    const st = row({ symbol: '600002', name: 'ST 股', isSt: true, price: 10 });
    const listLocalRows = vi.fn(async (includeST: boolean) => (includeST ? [normal, st] : [normal]));
    configureDefaults([normal], {
      listLocalRows,
      fetchStockSdkAllQuotes: async () => ({ quotes: [quoteFromRow(normal), quoteFromRow(st)], warnings: [] }),
    });

    const result = await screenASharesByConditions({});

    expect(listLocalRows).toHaveBeenCalledWith(true);
    expect(result.rows.map((item) => item.code)).toEqual(['600001', '600002']);
  });

  it('总市值小于条件不包含临界值', async () => {
    configureDefaults([
      row({ symbol: '600001', name: '小于上限', totalMarketCap: 14_900_000_000 }),
      row({ symbol: '600002', name: '等于上限', totalMarketCap: 15_000_000_000 }),
    ]);

    const result = await screenASharesByConditions({ maxTotalMarketCapYuanExclusive: 15_000_000_000 });

    expect(result.rows.map((item) => item.code)).toEqual(['600001']);
  });

  it('使用本轮 stock-sdk 全市场快照覆盖陈旧本地字段后筛选并批量回写', async () => {
    const upsertSnapshots = vi.fn().mockResolvedValue(undefined);
    const fetchStockSdkAllQuotes = vi.fn(async () => ({
      quotes: [
        { code: '600010', name: '已超市值上限股', price: 10, totalMarketCap: 120, turnoverRate: 18, amount: 50_000 },
        { code: '600011', name: '实时命中股', price: 10, totalMarketCap: 50, turnoverRate: 12, amount: 30_000 },
      ],
      warnings: [],
    }));
    configureDefaults(
      [
        row({
          symbol: '600010',
          name: '本地旧数据一',
          industry: '旧板块',
          totalMarketCap: 50,
          turnoverRate: 18,
          amount: 50_000,
        }),
        row({
          symbol: '600011',
          name: '本地旧数据二',
          industry: '新能源',
          totalMarketCap: 150,
          turnoverRate: 5,
          amount: 10_000,
        }),
      ],
      { upsertSnapshots, fetchStockSdkAllQuotes },
    );

    const result = await screenASharesByConditions({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
    });

    expect(fetchStockSdkAllQuotes).toHaveBeenCalledWith();
    expect(result.rows).toEqual([
      expect.objectContaining({
        code: '600011',
        name: '实时命中股',
        industry: '新能源',
        dataSource: 'stock-sdk',
        turnoverRate: 12,
        amountYuan: 300_000_000,
        totalMarketCapYuan: 5_000_000_000,
      }),
    ]);
    expect(upsertSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ code: '600010' }),
      expect.objectContaining({ code: '600011' }),
    ]);
  });

  it('stock-sdk 未补齐时使用 a-stock-data 行情字段', async () => {
    configureDefaults([row({ symbol: '000001', name: '待兜底股' })], {
      fetchStockSdkAllQuotes: async () => ({ quotes: [], warnings: ['stock-sdk 无返回'] }),
      fetchAStockDataQuotes: async () => ({
        quotes: [{ code: '000001', name: '待兜底股', totalMarketCap: 60, turnoverRate: 12, amount: 30_000 }],
        warnings: [],
      }),
    });

    const result = await screenASharesByConditions({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        code: '000001',
        dataSource: 'a-stock-data',
        amountYuan: 300_000_000,
      }),
    );
  });

  it('实时 Provider 都不可用时不把陈旧 DuckDB 行情当作当前筛选结果', async () => {
    configureDefaults(
      [row({ symbol: '600010', name: '陈旧本地行情股', totalMarketCap: 50, turnoverRate: 12, amount: 30_000 })],
      {
        fetchStockSdkAllQuotes: async () => ({ quotes: [], warnings: ['stock-sdk 无返回'] }),
        fetchAStockDataQuotes: async () => ({ quotes: [], warnings: ['a-stock-data 无返回'] }),
      },
    );

    const result = await screenASharesByConditions({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
    });

    expect(result.rows).toEqual([]);
    expect(result.freshness).toBe('stale');
    expect(result.isComplete).toBe(false);
    expect(result.warnings.join('；')).toContain('未获得可用于条件选股的当前全市场行情快照');
  });

  it('筹码缺失时立即返回本地真实缓存筛选结果，并在后台补齐缓存', async () => {
    let resolveChip: (() => void) | undefined;
    const blockedChip = new Promise<IChipDistributionResult>((resolve) => {
      resolveChip = () => resolve(chipResult(0.13, 0.7));
    });
    const getChipDistribution = vi.fn(() => blockedChip);
    configureDefaults(
      [
        row({ symbol: '600001', name: '筹码完整股', changePercent: 3 }),
        row({ symbol: '600002', name: '筹码待补齐股', changePercent: 3 }),
      ],
      {
        listStockChips: async () => [chip('600001', 0.12, 0.6)],
        getChipDistribution,
      },
    );

    const result = await screenASharesByConditions({
      concentration90MaxExclusive: 15,
      profitRatioMinExclusive: 50,
      changePercentMin: 0,
      changePercentMax: 5,
      excludeST: true,
    });

    expect(result.rows.map((item) => item.code)).toEqual(['600001']);
    expect(result.rows[0]).toEqual(expect.objectContaining({ concentration90Percent: 12, profitRatioPercent: 60 }));
    expect(result.sourceStats.missingChipData).toBe(1);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      '筹码数据待补齐 1 只，已基于本地真实筹码缓存完成本轮筛选；后台将补齐前 1 只供后续筛选使用',
    );
    expect(getChipDistribution).toHaveBeenCalledWith('600002');
    resolveChip?.();
  });

  it('后续筛选复用已持久化筹码，不重复请求同一只股票', async () => {
    const cachedChips = [chip('600001', 0.12, 0.6)];
    const getChipDistribution = vi.fn(async (symbol: string) => {
      const result = chipResult(0.13, 0.7);
      cachedChips.push({
        symbol,
        fetchedAt: '2026-08-17T09:31:00.000Z',
        data: result,
      });
      return result;
    });
    configureDefaults(
      [
        row({ symbol: '600001', name: '筹码完整股', changePercent: 3 }),
        row({ symbol: '600002', name: '筹码已补齐股', changePercent: 3 }),
      ],
      {
        listStockChips: async () => cachedChips,
        getChipDistribution,
      },
    );
    const input = {
      concentration90MaxExclusive: 15,
      profitRatioMinExclusive: 50,
      changePercentMin: 0,
      changePercentMax: 5,
      excludeST: true,
    };

    const first = await screenASharesByConditions(input);
    await vi.waitFor(() => expect(cachedChips).toHaveLength(2));
    const second = await screenASharesByConditions(input);

    expect(first.rows.map((item) => item.code)).toEqual(['600001']);
    expect(second.rows.map((item) => item.code)).toEqual(['600001', '600002']);
    expect(second.sourceStats.missingChipData).toBe(0);
    expect(getChipDistribution).toHaveBeenCalledTimes(1);
    expect(getChipDistribution).toHaveBeenCalledWith('600002');
  });

  it('板块范围只保留行业和概念涨幅前五的真实成分股', async () => {
    const boards: MarketBoardRecord[] = [
      {
        code: 'BK001',
        name: '行业一',
        kind: 'industry',
        changePercent: 6,
        source: 'duckdb',
        updatedAt: '2026-08-17T09:30:00.000Z',
      },
      {
        code: 'BK002',
        name: '概念二',
        kind: 'concept',
        changePercent: 5,
        source: 'duckdb',
        updatedAt: '2026-08-17T09:30:00.000Z',
      },
      {
        code: 'BK003',
        name: '行业三',
        kind: 'industry',
        changePercent: 4,
        source: 'duckdb',
        updatedAt: '2026-08-17T09:30:00.000Z',
      },
      {
        code: 'BK004',
        name: '概念四',
        kind: 'concept',
        changePercent: 3,
        source: 'duckdb',
        updatedAt: '2026-08-17T09:30:00.000Z',
      },
      {
        code: 'BK005',
        name: '行业五',
        kind: 'industry',
        changePercent: 2,
        source: 'duckdb',
        updatedAt: '2026-08-17T09:30:00.000Z',
      },
      {
        code: 'BK006',
        name: '概念六',
        kind: 'concept',
        changePercent: 1,
        source: 'duckdb',
        updatedAt: '2026-08-17T09:30:00.000Z',
      },
    ];
    configureDefaults(
      [row({ symbol: '600001', name: '前五板块成分股' }), row({ symbol: '600006', name: '第六板块成分股' })],
      {
        listMarketBoards: async () => boards,
        listBoardConstituents: async (boardCode) => {
          if (boardCode === 'BK001') {
            return [
              {
                boardCode,
                stockCode: '600001',
                stockName: '前五板块成分股',
                position: 0,
                updatedAt: '2026-08-17T09:30:00.000Z',
              },
            ];
          }
          if (boardCode === 'BK006') {
            return [
              {
                boardCode,
                stockCode: '600006',
                stockName: '第六板块成分股',
                position: 0,
                updatedAt: '2026-08-17T09:30:00.000Z',
              },
            ];
          }
          return [];
        },
      },
    );

    const result = await screenASharesByConditions({ leadingBoards: true });

    expect(result.leadingBoards).toHaveLength(5);
    expect(result.rows.map((item) => item.code)).toEqual(['600001']);
    expect(result.rows[0]?.leadingBoards).toEqual(['行业一']);
  });

  it('本地板块目录为空时通过默认真实刷新入口筛选领涨板块成分股', async () => {
    const remoteBoards: MarketBoardRow[] = [
      { code: 'BK001', name: '真实领涨板块', changePercent: 6.2, amount: 2_000_000_000, minutes: [] },
    ];
    sharedMocks.refreshMarketBoardRows.mockResolvedValue(remoteBoards);
    configureDefaults(
      [
        row({ symbol: '600001', name: '真实板块命中股', turnoverRate: 9, amount: 120_000 }),
        row({ symbol: '600002', name: '非领涨板块股', turnoverRate: 10, amount: 150_000 }),
      ],
      {
        listMarketBoards: async () => [],
        listBoardConstituents: async () => [],
        getBoardDetail: async (boardCode) => ({
          code: boardCode,
          name: '真实领涨板块',
          kline: [],
          constituents: [{ code: '600001', name: '真实板块命中股' }],
        }),
      },
      true,
    );

    const result = await screenASharesByConditions({
      leadingBoards: true,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 1_000_000_000,
    });

    expect(sharedMocks.refreshMarketBoardRows).toHaveBeenCalledOnce();
    expect(sharedMocks.getCachedMarketBoardRows).not.toHaveBeenCalled();
    expect(result.rows.map((item) => item.code)).toEqual(['600001']);
    expect(result.leadingBoards).toEqual([expect.objectContaining({ code: 'BK001', name: '真实领涨板块' })]);
    expect(result.matchedCount).toBe(1);
    expect(result.isComplete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('stock-sdk 板块不可用时使用新浪 a-stock-data 板块范围筛选', async () => {
    const getAStockDataBoardConstituents = vi.fn(async (boardCodes: string[]) => ({
      rows: boardCodes.includes('gn_top')
        ? [
            {
              boardCode: 'gn_top',
              stockCode: '600001',
              stockName: '新浪概念命中股',
              position: 0,
              updatedAt: '2026-08-18T09:30:00.000Z',
            },
          ]
        : [],
      warnings: [],
    }));
    configureDefaults(
      [
        row({ symbol: '600001', name: '新浪概念命中股', turnoverRate: 9, amount: 1_400_000 }),
        row({ symbol: '600002', name: '非领涨板块股', turnoverRate: 10, amount: 1_500_000 }),
      ],
      {
        getAStockDataBoards: async () => ({
          boards: [
            {
              code: 'gn_top',
              name: '新浪领涨概念',
              kind: 'concept',
              changePercent: 6.2,
              source: 'a-stock-data:sina',
              updatedAt: '2026-08-18T09:30:00.000Z',
            },
          ],
          warnings: [],
        }),
        getAStockDataBoardConstituents,
      },
    );

    const result = await screenASharesByConditions({
      leadingBoards: true,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 1_300_000_000,
    });

    expect(getAStockDataBoardConstituents).toHaveBeenCalledWith(['gn_top']);
    expect(result.rows.map((item) => item.code)).toEqual(['600001']);
    expect(result.leadingBoards).toEqual([expect.objectContaining({ code: 'gn_top', name: '新浪领涨概念' })]);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain('stock-sdk 暂不可用，未返回今日板块行情');
    expect(result.warnings).toContain('stock-sdk 板块行情暂不可用，已使用 a-stock-data 新浪板块数据继续筛选');
  });

  it('本地快照为空时直接使用真实全市场行情创建候选并回写', async () => {
    const upsertSecurities = vi.fn().mockResolvedValue(undefined);
    const upsertSnapshots = vi.fn().mockResolvedValue(undefined);
    configureDefaults([], {
      upsertSecurities,
      upsertSnapshots,
      fetchStockSdkAllQuotes: async () => ({
        quotes: [
          {
            code: '600001',
            name: '实时命中股',
            exchange: 'SH',
            price: 10,
            changePercent: 4,
            turnoverRate: 8,
            amount: 60_000,
            totalMarketCap: 50,
            fetchedAt: '2026-08-18T09:30:00.000Z',
          },
          {
            code: '600002',
            name: 'ST 排除股',
            exchange: 'SH',
            price: 10,
            changePercent: 4,
            turnoverRate: 9,
            amount: 70_000,
            totalMarketCap: 50,
            fetchedAt: '2026-08-18T09:30:00.000Z',
          },
        ],
        warnings: [],
      }),
    });

    const result = await screenASharesByConditions({
      changePercentMin: 3,
      changePercentMax: 8,
      turnoverRateMinExclusive: 6,
      amountMinYuanExclusive: 500_000_000,
      excludeST: true,
    });

    expect(result.rows.map((item) => item.code)).toEqual(['600001']);
    expect(result.storage).toBe('remote');
    expect(result.freshness).toBe('current');
    expect(upsertSecurities).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ symbol: '600001' })]),
    );
    expect(upsertSnapshots).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ code: '600001' })]));
  });
});

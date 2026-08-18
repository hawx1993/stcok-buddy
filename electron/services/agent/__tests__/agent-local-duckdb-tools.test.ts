import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const electron = {
    app: {
      getPath: () => os.tmpdir(),
      isPackaged: false,
    },
  };
  return { ...electron, default: electron };
});

import type { HotFocusItem, IChipDistributionResult, IMonitorEvent } from '../../../../src/shared/types.js';
import type { DailyBarRecord, SecurityRecord } from '../../market-data/types.js';

type TMarketDataStore = typeof import('../../market-data/market-data-store.js');
type TMonitorHistoryStore = typeof import('../../stock/monitor-history-store.js');
type TSurgeHistoryStore = typeof import('../../stock/surge-history-store.js');
type TLocalDuckDBTools = {
  screenLocalAStocks: (typeof import('../tools/screen-local-a-stocks.js'))['screenLocalAStocks'];
  queryLocalMarketDuckDB: (typeof import('../tools/query-local-market-duckdb.js'))['queryLocalMarketDuckDB'];
  queryLocalMonitorDuckDB: (typeof import('../tools/query-local-monitor-duckdb.js'))['queryLocalMonitorDuckDB'];
  queryLocalSurgeDuckDB: (typeof import('../tools/query-local-surge-duckdb.js'))['queryLocalSurgeDuckDB'];
};

let marketDbPath = '';
let monitorDbPath = '';
let surgeDbPath = '';
let marketStore: TMarketDataStore | undefined;
let monitorStore: TMonitorHistoryStore | undefined;
let surgeStore: TSurgeHistoryStore | undefined;
let tools: TLocalDuckDBTools | undefined;

function removeDbFiles(target: string) {
  for (const suffix of ['', '.wal']) rmSync(`${target}${suffix}`, { force: true });
}

async function loadModules() {
  const suffix = `${process.pid}-${Date.now()}-${Math.random()}`;
  marketDbPath = path.join(os.tmpdir(), `stocksense-agent-market-${suffix}.duckdb`);
  monitorDbPath = path.join(os.tmpdir(), `stocksense-agent-monitor-${suffix}.duckdb`);
  surgeDbPath = path.join(os.tmpdir(), `stocksense-agent-surge-${suffix}.duckdb`);
  process.env.STOCKSENSE_MARKET_DB_PATH = marketDbPath;
  process.env.STOCKSENSE_MONITOR_DB_PATH = monitorDbPath;
  process.env.STOCKSENSE_SURGE_DB_PATH = surgeDbPath;
  vi.resetModules();
  marketStore = await import('../../market-data/market-data-store.js');
  monitorStore = await import('../../stock/monitor-history-store.js');
  surgeStore = await import('../../stock/surge-history-store.js');
  const [screening, marketQuery, monitorQuery, surgeQuery] = await Promise.all([
    import('../tools/screen-local-a-stocks.js'),
    import('../tools/query-local-market-duckdb.js'),
    import('../tools/query-local-monitor-duckdb.js'),
    import('../tools/query-local-surge-duckdb.js'),
  ]);
  tools = {
    screenLocalAStocks: screening.screenLocalAStocks,
    queryLocalMarketDuckDB: marketQuery.queryLocalMarketDuckDB,
    queryLocalMonitorDuckDB: monitorQuery.queryLocalMonitorDuckDB,
    queryLocalSurgeDuckDB: surgeQuery.queryLocalSurgeDuckDB,
  };
  await marketStore.initializeMarketDataStore();
}

function createSecurity(overrides: Partial<SecurityRecord> = {}): SecurityRecord {
  return {
    symbol: '600519',
    name: '贵州茅台',
    exchange: 'SH',
    securityType: 'stock',
    status: 'listed',
    listDate: '2001-08-27',
    industry: '白酒',
    isSt: false,
    source: 'vitest',
    updatedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

function createBar(overrides: Partial<DailyBarRecord> = {}): DailyBarRecord {
  return {
    symbol: '600519',
    tradeDate: '2026-07-09',
    open: 10,
    high: 11,
    low: 9.8,
    close: 10.8,
    volume: 1000,
    amount: 10_000_000,
    change: 0.6,
    changePercent: 6,
    turnoverRate: 3,
    adjustType: 'qfq',
    source: 'vitest',
    fetchedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

function createChip(concentration90: number, concentrations90?: number[]): IChipDistributionResult {
  const values = concentrations90 ?? [concentration90];
  const distributions = values.map((value, index) => ({
    date: `2026-07-${String(9 - values.length + index + 1).padStart(2, '0')}`,
    concentration90: value,
    concentration70: 0.08,
    profitRatio: 0.72,
    points: [{ price: 10, weight: 1 }],
  }));
  return {
    latest: distributions.at(-1),
    distributions,
    trend: [],
    source: 'stock-sdk',
  };
}

function createMonitorEvent(overrides: Partial<IMonitorEvent> = {}): IMonitorEvent {
  return {
    id: 'monitor-1',
    category: 'technical',
    timestamp: '2026-07-09T10:00:00.000Z',
    code: '600519',
    name: '贵州茅台',
    price: 10.8,
    changePercent: 6,
    title: '日内强势信号',
    details: ['当前涨跌幅 +6.00%'],
    aiAnalysis: '测试监控事件',
    ...overrides,
  };
}

function createSurgeItem(overrides: Partial<HotFocusItem> = {}): HotFocusItem {
  return {
    id: 'surge-1',
    title: '贵州茅台 600519',
    code: '600519',
    name: '贵州茅台',
    time: '10:01',
    price: '10.80',
    changePercent: '+6.00%',
    amount: '买入1万手',
    description: '特大单买入',
    tag: '特大单买入',
    type: 'surge',
    ...overrides,
  };
}

beforeEach(async () => {
  await loadModules();
});

afterEach(async () => {
  if (marketStore) {
    await marketStore.closeMarketDataStore(1000);
    await marketStore.resetMarketDataStore();
  }
  if (monitorStore) {
    await monitorStore.closeMonitorHistoryStore(1000);
    await monitorStore.closeMonitorHistoryInstance();
  }
  if (surgeStore) {
    surgeStore.clearSurgeHistoryClearMarker();
    await surgeStore.closeSurgeHistoryStore(1000);
    await surgeStore.closeSurgeHistoryInstance();
  }
  for (const dbPath of [marketDbPath, monitorDbPath, surgeDbPath]) {
    if (dbPath) removeDbFiles(dbPath);
  }
  delete process.env.STOCKSENSE_MARKET_DB_PATH;
  delete process.env.STOCKSENSE_MONITOR_DB_PATH;
  delete process.env.STOCKSENSE_SURGE_DB_PATH;
  marketStore = undefined;
  monitorStore = undefined;
  surgeStore = undefined;
  tools = undefined;
  vi.resetModules();
});

describe('本地 DuckDB Agent 工具', () => {
  it('按涨幅和 90% 筹码集中度筛选全市场本地股票', async () => {
    if (!marketStore || !tools) throw new Error('modules not loaded');

    await marketStore.upsertSecurities([
      createSecurity({ symbol: '600519', name: '贵州茅台' }),
      createSecurity({ symbol: '000001', name: '平安银行', exchange: 'SZ', industry: '银行' }),
      createSecurity({ symbol: '002001', name: '新和成', exchange: 'SZ', industry: '化工' }),
    ]);
    await marketStore.upsertDailyBars([
      createBar({ symbol: '600519', tradeDate: '2026-07-09', changePercent: 6.2, close: 10.8 }),
      createBar({ symbol: '000001', tradeDate: '2026-07-09', changePercent: 6.5, close: 12.3 }),
      createBar({ symbol: '002001', tradeDate: '2026-07-09', changePercent: 4.8, close: 18.2 }),
    ]);
    await marketStore.upsertStockSnapshots([
      { symbol: '600519', name: '贵州茅台', price: 10.8, changePercent: 6.2, amount: 30_000_000, turnoverRate: 3.2 },
      { symbol: '000001', name: '平安银行', price: 12.3, changePercent: 6.5, amount: 50_000_000, turnoverRate: 2.1 },
      { symbol: '002001', name: '新和成', price: 18.2, changePercent: 4.8, amount: 20_000_000, turnoverRate: 1.5 },
    ]);
    await marketStore.upsertStockChip('600519', createChip(0.145));
    await marketStore.upsertStockChip('000001', createChip(0.16));
    await marketStore.upsertStockChip('002001', createChip(0.1));

    const result = await tools.screenLocalAStocks.run({
      concentration90Max: 15,
      changePercentMin: 5,
      sortBy: 'changePercent',
      sortOrder: 'desc',
      limit: 10,
    });

    expect(result).toMatchObject({
      source: 'duckdb:market',
      storage: 'local',
      latestTradeDate: '2026-07-09',
      matchedCount: 1,
      returnedCount: 1,
      isEmpty: false,
    });
    expect(result.rows).toEqual([expect.objectContaining({ code: '600519', name: '贵州茅台', changePercent: 6.2 })]);
    expect(result.rows[0].concentration90Percent).toBeCloseTo(14.5);
  });

  it('按最近 5 天 90% 筹码集中度窗口筛选全市场本地股票', async () => {
    if (!marketStore || !tools) throw new Error('modules not loaded');

    await marketStore.upsertSecurities([
      createSecurity({ symbol: '600519', name: '贵州茅台' }),
      createSecurity({ symbol: '000001', name: '平安银行', exchange: 'SZ', industry: '银行' }),
    ]);
    await marketStore.upsertDailyBars([
      createBar({ symbol: '600519', tradeDate: '2026-07-09', changePercent: 1.2, close: 10.8 }),
      createBar({ symbol: '000001', tradeDate: '2026-07-09', changePercent: 1.5, close: 12.3 }),
    ]);
    await marketStore.upsertStockSnapshots([
      { symbol: '600519', name: '贵州茅台', price: 10.8, changePercent: 1.2, amount: 30_000_000, turnoverRate: 3.2 },
      { symbol: '000001', name: '平安银行', price: 12.3, changePercent: 1.5, amount: 50_000_000, turnoverRate: 2.1 },
    ]);
    await marketStore.upsertStockChip('600519', createChip(0.18, [0.16, 0.17, 0.18, 0.19, 0.18]));
    await marketStore.upsertStockChip('000001', createChip(0.18, [0.16, 0.17, 0.21, 0.19, 0.18]));

    const result = await tools.screenLocalAStocks.run({
      concentration90Max: 20,
      chipLookbackDays: 5,
      chipMatchMode: 'all',
      sortBy: 'concentration90',
      sortOrder: 'asc',
      limit: 10,
    });

    expect(result).toMatchObject({ matchedCount: 1, returnedCount: 1, isEmpty: false });
    expect(result.rows[0]).toMatchObject({ code: '600519', chipLookbackDays: 5, chipMatchedDays: 5 });
    expect(result.rows[0].recentConcentration90Percent).toEqual([16, 17, 18, 19, 18]);
  });

  it('查询 market DuckDB 白名单数据集', async () => {
    if (!marketStore || !tools) throw new Error('modules not loaded');

    await marketStore.upsertTradingCalendar([
      { market: 'A', tradeDate: '2026-07-09', isOpen: true, source: 'vitest', updatedAt: '2026-07-09T10:00:00.000Z' },
    ]);

    const result = await tools.queryLocalMarketDuckDB.run({ dataset: 'trade_calendar', market: 'A', limit: 5 });
    expect(result).toMatchObject({ source: 'duckdb:market', dataset: 'trade_calendar', isEmpty: false });
    expect(result.rows).toEqual([expect.objectContaining({ market: 'A', tradeDate: '2026-07-09' })]);
  });

  it('查询 monitor 与 surge 本地历史', async () => {
    if (!monitorStore || !surgeStore || !tools) throw new Error('modules not loaded');

    await monitorStore.saveMonitorEvents([createMonitorEvent()], new Date('2026-07-09T10:00:00.000Z'), '2026-07-09');
    await surgeStore.saveSurgeSnapshot([createSurgeItem()], new Date('2026-07-09T10:01:00.000Z'), '2026-07-09');

    const monitor = await tools.queryLocalMonitorDuckDB.run({
      date: '2026-07-09',
      categories: ['technical'],
      includeCounts: true,
    });
    expect(monitor).toMatchObject({ source: 'duckdb:monitor', dataset: 'ai_monitor_events', total: 1, isEmpty: false });
    expect(monitor.rows).toEqual([expect.objectContaining({ code: '600519', title: '日内强势信号' })]);

    const surge = await tools.queryLocalSurgeDuckDB.run({ date: '2026-07-09', limit: 10 });
    expect(surge).toMatchObject({ source: 'duckdb:surge', dataset: 'stock_surge_events', isEmpty: false });
    expect(surge.rows).toEqual([expect.objectContaining({ code: '600519', title: '贵州茅台 600519' })]);
  });

  it('按买入手数筛选全市场异动时不会漏掉 000889', async () => {
    if (!surgeStore || !tools) throw new Error('modules not loaded');

    await surgeStore.saveSurgeSnapshot(
      [
        createSurgeItem({
          id: 'large-buy-000889',
          title: '中嘉博创 000889',
          code: '000889',
          name: '中嘉博创',
          time: '11:28',
          amount: '买入1.02万手',
        }),
        createSurgeItem({
          id: 'large-buy-300552',
          title: '万集科技 300552',
          code: '300552',
          name: '万集科技',
          time: '11:29',
          amount: '买入1.2万手',
        }),
        createSurgeItem({
          id: 'small-buy-600000',
          title: '浦发银行 600000',
          code: '600000',
          name: '浦发银行',
          time: '11:30',
          amount: '买入9999手',
        }),
        createSurgeItem({
          id: 'large-sell-000001',
          title: '平安银行 000001',
          code: '000001',
          name: '平安银行',
          time: '11:31',
          amount: '卖出2万手',
          tag: '特大单卖出',
          description: '特大单卖出',
          type: 'plummet',
        }),
      ],
      new Date('2026-08-05T03:31:00.000Z'),
      '2026-08-05',
    );

    const result = await tools.queryLocalSurgeDuckDB.run({
      date: '2026-08-05',
      side: 'buy',
      minHands: 10000,
      limit: 100,
    });

    expect(result).toMatchObject({ source: 'duckdb:surge', dataset: 'stock_surge_events', isEmpty: false });
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '000889', name: '中嘉博创', amount: '买入1.02万手' }),
        expect.objectContaining({ code: '300552', name: '万集科技', amount: '买入1.2万手' }),
      ]),
    );
    expect(result.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '600000' }),
        expect.objectContaining({ code: '000001' }),
      ]),
    );
  });

  it('未指定日期时按近期可用异动历史筛选全市场买入手数', async () => {
    if (!surgeStore || !tools) throw new Error('modules not loaded');

    await surgeStore.saveSurgeSnapshot(
      [
        createSurgeItem({
          id: 'recent-large-buy-000889',
          title: '中嘉博创 000889',
          code: '000889',
          name: '中嘉博创',
          time: '11:28',
          amount: '买入1.02万手',
        }),
        createSurgeItem({
          id: 'recent-small-buy-600000',
          title: '浦发银行 600000',
          code: '600000',
          name: '浦发银行',
          time: '11:30',
          amount: '买入9999手',
        }),
      ],
      new Date('2026-08-05T03:31:00.000Z'),
      '2026-08-05',
    );
    await surgeStore.saveSurgeSnapshot(
      [
        createSurgeItem({
          id: 'older-large-buy-300552',
          title: '万集科技 300552',
          code: '300552',
          name: '万集科技',
          time: '10:29',
          amount: '买入1.2万手',
        }),
        createSurgeItem({
          id: 'older-large-sell-000001',
          title: '平安银行 000001',
          code: '000001',
          name: '平安银行',
          time: '10:31',
          amount: '卖出2万手',
          tag: '特大单卖出',
          description: '特大单卖出',
          type: 'plummet',
        }),
      ],
      new Date('2026-08-04T03:31:00.000Z'),
      '2026-08-04',
    );

    const result = await tools.queryLocalSurgeDuckDB.run({ side: 'buy', minHands: 10000, keepDays: 7, limit: 100 });

    expect(result).toMatchObject({ source: 'duckdb:surge', dataset: 'stock_surge_events', isEmpty: false });
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '000889', amount: '买入1.02万手' }),
        expect.objectContaining({ code: '300552', amount: '买入1.2万手' }),
      ]),
    );
    expect(result.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '600000' }),
        expect.objectContaining({ code: '000001' }),
      ]),
    );
  });

  it('全市场按买入手数筛选时整日扫描，不因当日行数超过100条而漏掉早盘特大单', async () => {
    if (!surgeStore || !tools) throw new Error('modules not loaded');

    // 当日下午 14:30 的 120 条噪声异动会占满单页 100 条上限（按时间倒序），
    // 早盘 09:35 的特大单买入必须通过整日扫描被找到。
    const items: HotFocusItem[] = Array.from({ length: 120 }, (_, index) =>
      createSurgeItem({
        id: `noise-${index}`,
        title: `噪声股 ${600000 + index}`,
        code: String(600000 + index),
        name: `噪声股${index}`,
        time: '14:30',
        amount: '买入5000手',
        tag: '快速涨幅',
        description: '快速涨幅',
      }),
    );
    items.push(
      createSurgeItem({
        id: 'early-large-buy-000889',
        title: '中嘉博创 000889',
        code: '000889',
        name: '中嘉博创',
        time: '09:35',
        amount: '买入1.02万手',
      }),
    );
    await surgeStore.saveSurgeSnapshot(items, new Date('2026-08-05T03:31:00.000Z'), '2026-08-05');

    const result = await tools.queryLocalSurgeDuckDB.run({
      date: '2026-08-05',
      side: 'buy',
      minHands: 10000,
      limit: 100,
    });

    expect(result).toMatchObject({ source: 'duckdb:surge', dataset: 'stock_surge_events', isEmpty: false });
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '000889', name: '中嘉博创', amount: '买入1.02万手', tradeDate: '2026-08-05' }),
      ]),
    );
  });

  it('全市场按买入手数筛选时按股票聚合，同一股票多次特大单只保留最新一条', async () => {
    if (!surgeStore || !tools) throw new Error('modules not loaded');

    await surgeStore.saveSurgeSnapshot(
      [
        createSurgeItem({
          id: 'buy-1',
          title: '嘉麟杰 002486',
          code: '002486',
          name: '嘉麟杰',
          time: '10:36:30',
          amount: '买入1.40万手',
          changePercent: '+1.66%',
        }),
        createSurgeItem({
          id: 'buy-2',
          title: '嘉麟杰 002486',
          code: '002486',
          name: '嘉麟杰',
          time: '10:37:09',
          amount: '买入1.89万手',
          changePercent: '+3.32%',
        }),
        createSurgeItem({
          id: 'buy-3',
          title: '成都路桥 002628',
          code: '002628',
          name: '成都路桥',
          time: '10:39:57',
          amount: '买入1.03万手',
          changePercent: '-0.20%',
        }),
      ],
      new Date('2026-08-05T03:31:00.000Z'),
      '2026-08-05',
    );

    const result = await tools.queryLocalSurgeDuckDB.run({
      date: '2026-08-05',
      side: 'buy',
      minHands: 10000,
      limit: 100,
    });

    expect(result).toMatchObject({ source: 'duckdb:surge', dataset: 'stock_surge_events', isEmpty: false });
    expect(result.rows).toHaveLength(2);
    const jialin = (result.rows ?? []).filter((row) => (row as { code?: string }).code === '002486');
    expect(jialin).toHaveLength(1);
    expect(jialin[0]).toMatchObject({ time: '10:37:09', changePercent: '+3.32%', tradeDate: '2026-08-05' });
  });

  it('无筹码条件时不再剔除缺少筹码缓存的股票', async () => {
    if (!marketStore || !tools) throw new Error('modules not loaded');

    await marketStore.upsertSecurities([
      createSecurity({ symbol: '600519', name: '贵州茅台' }),
      createSecurity({ symbol: '000001', name: '平安银行', exchange: 'SZ', industry: '银行' }),
    ]);
    await marketStore.upsertStockSnapshots([
      { symbol: '600519', name: '贵州茅台', price: 10.8, changePercent: 6.2, amount: 30_000_000, turnoverRate: 12.3 },
      { symbol: '000001', name: '平安银行', price: 12.3, changePercent: 6.5, amount: 50_000_000, turnoverRate: 2.1 },
    ]);
    // 只有 600519 有筹码缓存，000001 没有 —— 纯换手率/涨幅筛选不应剔除 000001
    await marketStore.upsertStockChip('600519', createChip(0.145));

    const result = await tools.screenLocalAStocks.run({
      turnoverRateMin: 10,
      sortBy: 'turnoverRate',
      sortOrder: 'desc',
      limit: 10,
    });

    expect(result).toMatchObject({
      source: 'duckdb:market',
      storage: 'local',
      matchedCount: 1,
      returnedCount: 1,
      isEmpty: false,
    });
    expect(result.rows).toEqual([expect.objectContaining({ code: '600519', name: '贵州茅台', turnoverRate: 12.3 })]);
    expect(result.rows[0].concentration90Percent).toBeCloseTo(14.5);
  });

  it('按换手率区间筛选本地股票（含无筹码缓存股票）', async () => {
    if (!marketStore || !tools) throw new Error('modules not loaded');

    await marketStore.upsertSecurities([
      createSecurity({ symbol: '600519', name: '贵州茅台' }),
      createSecurity({ symbol: '000001', name: '平安银行', exchange: 'SZ', industry: '银行' }),
      createSecurity({ symbol: '002001', name: '新和成', exchange: 'SZ', industry: '化工' }),
    ]);
    await marketStore.upsertStockSnapshots([
      { symbol: '600519', name: '贵州茅台', price: 10.8, changePercent: 1.2, amount: 30_000_000, turnoverRate: 3.2 },
      { symbol: '000001', name: '平安银行', price: 12.3, changePercent: 1.5, amount: 50_000_000, turnoverRate: 15.5 },
      { symbol: '002001', name: '新和成', price: 18.2, changePercent: 1.1, amount: 20_000_000, turnoverRate: 25.1 },
    ]);

    const result = await tools.screenLocalAStocks.run({
      turnoverRateMin: 10,
      turnoverRateMax: 20,
      sortBy: 'turnoverRate',
      sortOrder: 'desc',
      limit: 10,
    });

    expect(result).toMatchObject({ matchedCount: 1, returnedCount: 1, isEmpty: false });
    expect(result.rows).toEqual([expect.objectContaining({ code: '000001', name: '平安银行', turnoverRate: 15.5 })]);
  });

  it('查询 stock_snapshot 数据集返回含市值与换手率的快照', async () => {
    if (!marketStore || !tools) throw new Error('modules not loaded');

    await marketStore.upsertStockSnapshots([
      {
        symbol: '600519',
        name: '贵州茅台',
        price: 10.8,
        changePercent: 1.2,
        amount: 30_000_000,
        turnoverRate: 3.2,
        totalMarketCap: 20_000_000_000,
        circulatingMarketCap: 20_000_000_000,
      },
      {
        symbol: '000001',
        name: '平安银行',
        price: 12.3,
        changePercent: 1.5,
        amount: 50_000_000,
        turnoverRate: 15.5,
        totalMarketCap: 30_000_000_000,
        circulatingMarketCap: 25_000_000_000,
      },
    ]);

    const result = await tools.queryLocalMarketDuckDB.run({ dataset: 'stock_snapshot', limit: 100 });

    expect(result).toMatchObject({ source: 'duckdb:market', dataset: 'stock_snapshot', isEmpty: false });
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '600519', name: '贵州茅台', turnoverRate: 3.2, marketCapYi: 200 }),
        expect.objectContaining({ code: '000001', name: '平安银行', turnoverRate: 15.5, marketCapYi: 300 }),
      ]),
    );
  });

  it('未知数据集返回告警而不是静默降级', async () => {
    if (!tools) throw new Error('modules not loaded');

    const result = await tools.queryLocalMarketDuckDB.run({ dataset: 'not_a_real_dataset', limit: 100 });

    expect(result).toMatchObject({ dataset: 'not_a_real_dataset', isEmpty: true });
    expect(result.warnings.join('；')).toContain('不在白名单内');
  });
});

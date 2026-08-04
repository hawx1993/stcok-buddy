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
type TLocalDuckDBTools = typeof import('../agent-local-duckdb-tools.js');

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
  tools = await import('../agent-local-duckdb-tools.js');
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

function createChip(concentration90: number): IChipDistributionResult {
  return {
    latest: {
      date: '2026-07-09',
      concentration90,
      concentration70: 0.08,
      profitRatio: 0.72,
      points: [{ price: 10, weight: 1 }],
    },
    distributions: [],
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

    expect(result).toMatchObject({ source: 'duckdb:market', storage: 'local', latestTradeDate: '2026-07-09', matchedCount: 1, returnedCount: 1, isEmpty: false });
    expect(result.rows).toEqual([
      expect.objectContaining({ code: '600519', name: '贵州茅台', changePercent: 6.2 }),
    ]);
    expect(result.rows[0].concentration90Percent).toBeCloseTo(14.5);
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

    const monitor = await tools.queryLocalMonitorDuckDB.run({ date: '2026-07-09', categories: ['technical'], includeCounts: true });
    expect(monitor).toMatchObject({ source: 'duckdb:monitor', dataset: 'ai_monitor_events', total: 1, isEmpty: false });
    expect(monitor.rows).toEqual([expect.objectContaining({ code: '600519', title: '日内强势信号' })]);

    const surge = await tools.queryLocalSurgeDuckDB.run({ date: '2026-07-09', limit: 10 });
    expect(surge).toMatchObject({ source: 'duckdb:surge', dataset: 'stock_surge_events', isEmpty: false });
    expect(surge.rows).toEqual([expect.objectContaining({ code: '600519', title: '贵州茅台 600519' })]);
  });
});

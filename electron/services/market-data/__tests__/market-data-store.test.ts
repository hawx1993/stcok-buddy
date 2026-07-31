import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

import type { BoardDetail, MarketBoardRow } from '../../../../src/shared/types.js';
import type { DailyBarRecord, SecurityRecord } from '../types.js';

type TMarketDataStore = typeof import('../market-data-store.js');

let dbPath = '';
let store: TMarketDataStore | undefined;

function removeDbFiles(target: string) {
  for (const suffix of ['', '.wal']) rmSync(`${target}${suffix}`, { force: true });
}

async function loadStore() {
  dbPath = path.join(os.tmpdir(), `stocksense-market-vitest-${process.pid}-${Date.now()}-${Math.random()}.duckdb`);
  process.env.STOCKSENSE_MARKET_DB_PATH = dbPath;
  vi.resetModules();
  store = await import('../market-data-store.js');
  await store.initializeMarketDataStore();
  return store;
}

function createBar(overrides: Partial<DailyBarRecord> = {}): DailyBarRecord {
  return {
    symbol: '600519',
    tradeDate: '2026-07-09',
    open: 1500,
    high: 1520,
    low: 1490,
    close: 1510,
    volume: 1000,
    amount: 10_000_000,
    change: 12,
    changePercent: 0.8,
    turnoverRate: 1.2,
    adjustType: 'qfq',
    source: 'vitest',
    fetchedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
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

beforeEach(async () => {
  await loadStore();
});

afterEach(async () => {
  if (store) {
    await store.closeMarketDataStore(1000);
    await store.resetMarketDataStore();
  }
  if (dbPath) removeDbFiles(dbPath);
  delete process.env.STOCKSENSE_MARKET_DB_PATH;
  store = undefined;
  dbPath = '';
  vi.resetModules();
});

describe('市场数据 DuckDB 存储', () => {
  it('可以重复初始化并按股票日期复权类型写入日 K', async () => {
    const currentStore = store;
    expect(currentStore).toBeDefined();
    if (!currentStore) throw new Error('market data store not loaded');

    await currentStore.initializeMarketDataStore();
    await currentStore.upsertDailyBars([
      createBar({ close: 1510 }),
      createBar({ close: 1512 }),
      createBar({ tradeDate: '2026-07-10', close: 1520 }),
      createBar({ tradeDate: '2026-07-08', close: 1498 }),
    ]);
    await currentStore.upsertDailyBars([createBar({ adjustType: 'none', close: 1505 })]);

    const qfqBars = await currentStore.listDailyBars('600519', { adjustType: 'qfq' });
    expect(qfqBars.map((bar) => bar.tradeDate)).toEqual(['2026-07-08', '2026-07-09', '2026-07-10']);
    expect(qfqBars.find((bar) => bar.tradeDate === '2026-07-09')?.close).toBe(1512);

    const noneBars = await currentStore.listDailyBars('600519', { adjustType: 'none' });
    expect(noneBars).toHaveLength(1);
    expect(noneBars[0].close).toBe(1505);

    const ranged = await currentStore.listDailyBars('600519', {
      startDate: '2026-07-09',
      endDate: '2026-07-10',
      limit: 1,
      adjustType: 'qfq',
    });
    expect(ranged.map((bar) => bar.tradeDate)).toEqual(['2026-07-10']);
    expect(await currentStore.getLatestDailyBar('600519', 'qfq')).toMatchObject({ tradeDate: '2026-07-10', close: 1520 });
    expect(await currentStore.countDailyBarsForDate('2026-07-09')).toBe(1);
  });

  it('可以写入证券主表并关联最新行情行', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('market data store not loaded');

    await currentStore.upsertSecurities([
      createSecurity(),
      createSecurity({ symbol: '000001', name: '平安银行', exchange: 'SZ', industry: '银行' }),
      createSecurity({ symbol: '300001', name: '退市样本', exchange: 'SZ', status: 'delisted' }),
    ]);
    await currentStore.upsertSecurities([createSecurity({ symbol: '600519', name: '贵州茅台更新', industry: '食品饮料' })]);
    await currentStore.upsertDailyBars([
      createBar({ symbol: '600519', tradeDate: '2026-07-08', close: 1500 }),
      createBar({ symbol: '600519', tradeDate: '2026-07-10', close: 1525, amount: 12_000_000 }),
      createBar({ symbol: '000001', tradeDate: '2026-07-10', close: 12.3, amount: 8_000_000 }),
    ]);

    const securities = await currentStore.listSecurities();
    expect(securities.map((item) => item.symbol)).toEqual(['000001', '600519']);
    expect(securities.find((item) => item.symbol === '600519')).toMatchObject({ name: '贵州茅台更新', industry: '食品饮料' });

    const rows = await currentStore.listLatestMarketRows();
    expect(rows.find((row) => row.code === '600519')).toMatchObject({ name: '贵州茅台更新', price: 1525, amount: 12_000_000 });
    expect(rows.some((row) => row.code === '300001')).toBe(false);
  });

  it('可以替换板块成分股并聚合板块成交额', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('market data store not loaded');

    const updatedAt = '2026-07-09T10:00:00.000Z';
    await currentStore.upsertMarketBoards([
      { code: 'BK1556', name: '教育运营及其他', source: 'vitest', updatedAt },
      { code: 'BK1556', name: '教育运营及其他', kind: 'industry', changePercent: 1.2, source: 'vitest', updatedAt },
      { code: 'BK0465', name: '化学制药', kind: 'industry', changePercent: 0.8, source: 'vitest', updatedAt },
    ]);
    await currentStore.upsertStockSnapshots([
      { symbol: '600519', name: '贵州茅台', amount: 12_000_000 },
      { symbol: '000001', name: '平安银行', amount: 8_000_000 },
    ]);
    await currentStore.replaceBoardConstituents('BK1556', [
      { boardCode: 'BK1556', stockCode: '600519', stockName: '贵州茅台', position: 1, updatedAt },
      { boardCode: 'BK1556', stockCode: '000001', stockName: '平安银行', position: 2, updatedAt },
    ]);
    await currentStore.replaceBoardConstituents('BK1556', [
      { boardCode: 'BK1556', stockCode: '000001', stockName: '平安银行', position: 1, updatedAt },
    ]);

    const constituents = await currentStore.listBoardConstituents('BK1556');
    expect(constituents).toEqual([
      expect.objectContaining({ boardCode: 'BK1556', stockCode: '000001', stockName: '平安银行', position: 1, updatedAt: expect.any(String) }),
    ]);

    const boards = await currentStore.listMarketBoards();
    expect(boards.filter((row) => row.code === 'BK1556')).toHaveLength(1);
    expect(boards.find((row) => row.code === 'BK1556')).toMatchObject({ kind: 'industry', changePercent: 1.2, amount: 8_000_000 });
    expect(boards.find((row) => row.code === 'BK0465')).toMatchObject({ amount: undefined });
  });

  it('可以读写 JSON 缓存记录', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('market data store not loaded');

    const boardRows: MarketBoardRow[] = [{ code: 'BK1556', name: '教育运营及其他', minutes: [], changePercent: 1.2 }];
    const boardDetail: BoardDetail = {
      code: 'BK1556',
      name: '教育运营及其他',
      changePercent: '+1.20%',
      constituents: [{ code: '600519', name: '贵州茅台' }],
    };
    const chip = { latest: { date: '2026-07-09', profitRatio: 0.62 }, source: 'vitest' };

    await currentStore.writeDiscoverySnapshot({ snapshot: { rows: [{ code: '600519' }] }, updatedAt: '2026-07-09T10:00:00.000Z' }, 'home');
    await currentStore.writeBoardSnapshot({ rows: boardRows, updatedAt: '2026-07-09T10:01:00.000Z' }, 'industry');
    await currentStore.writeBoardDetail({ detail: boardDetail, updatedAt: '2026-07-09T10:02:00.000Z' });
    await currentStore.upsertStockChip('600519', chip);

    expect(await currentStore.readDiscoverySnapshot('home')).toMatchObject({ snapshot: { rows: [{ code: '600519' }] }, updatedAt: expect.any(String) });
    expect(await currentStore.readBoardSnapshot('industry')).toMatchObject({ rows: boardRows, updatedAt: expect.any(String) });
    expect(await currentStore.readBoardDetail('BK1556')).toMatchObject({ detail: boardDetail, updatedAt: expect.any(String) });
    expect(await currentStore.getStockChip('600519')).toEqual(chip);
    expect(await currentStore.getStockChip('000001')).toBeUndefined();
  });

  it('可以记录同步任务、失败项和统计信息', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('market data store not loaded');

    await currentStore.upsertSecurities([createSecurity()]);
    await currentStore.upsertDailyBars([createBar()]);
    await currentStore.createSyncJob({ id: 'job-1', jobType: 'daily_incremental', targetTradeDate: '2026-07-09', totalSymbols: 2 });
    await currentStore.updateSyncJob('job-1', {
      status: 'partial',
      processedSymbols: 2,
      succeededSymbols: 1,
      failedSymbols: 1,
      checkpointSymbol: '600519',
      errorMessage: 'offline',
      finishedAt: '2026-07-09T10:10:00.000Z',
    });
    await currentStore.recordSyncFailure('job-1', '000001', 'daily', 'offline');
    await currentStore.recordSyncFailure('job-1', '000001', 'daily', 'still offline');

    expect(await currentStore.getLatestSyncJob()).toMatchObject({
      id: 'job-1',
      status: 'partial',
      processedSymbols: 2,
      succeededSymbols: 1,
      failedSymbols: 1,
      checkpointSymbol: '600519',
      errorMessage: 'offline',
    });
    expect(await currentStore.listLatestSyncFailures()).toEqual([{ jobId: 'job-1', symbol: '000001', stage: 'daily' }]);

    const stats = await currentStore.getMarketDataStats();
    expect(stats).toMatchObject({ securityCount: 1, dailyBarCount: 1, latestTradeDate: '2026-07-09', failedSymbols: 1 });
    expect(stats.databaseBytes).toBeGreaterThan(0);

    await currentStore.clearSyncFailure('job-1', '000001', 'daily');
    expect(await currentStore.listLatestSyncFailures()).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IHotStockHintSource } from '../../../../src/shared/types.js';

interface IHotSnapshotRow {
  cache_date: string;
  trade_date: string | null;
  is_previous_trade_day: number;
  items_json: string;
  updated_at: string;
}

interface IHotSnapshotInput {
  cacheDate: string;
  tradeDate: string | null;
  isPreviousTradeDay: number;
  itemsJson: string;
  updatedAt: string;
}

const database = vi.hoisted(() => ({
  snapshots: [] as IHotSnapshotRow[],
}));

vi.mock('../../../electron-runtime', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
}));

vi.mock('better-sqlite3', () => ({
  default: class FakeDatabase {
    open = true;

    pragma() {}

    exec() {}

    close() {
      this.open = false;
    }

    prepare(sql: string) {
      return {
        all: () => [],
        get: () => readRow(sql),
        run: (...params: unknown[]) => writeRow(sql, params),
      };
    }

    transaction<T extends unknown[]>(work: (...args: T) => void) {
      return (...args: T) => work(...args);
    }
  },
}));

type TQuoteStore = typeof import('../quote-store.js');

let store: TQuoteStore | undefined;

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

function readRow(sql: string) {
  if (!sql.includes('FROM hot_stock_hint_snapshots')) return undefined;
  return [...database.snapshots].sort((left, right) => right.cache_date.localeCompare(left.cache_date))[0];
}

function writeRow(sql: string, params: unknown[]) {
  if (!sql.includes('INSERT INTO hot_stock_hint_snapshots')) return;
  const input = params[0];
  if (!isHotSnapshotInput(input)) throw new Error('热点快照写入参数无效');

  const row: IHotSnapshotRow = {
    cache_date: input.cacheDate,
    trade_date: input.tradeDate,
    is_previous_trade_day: input.isPreviousTradeDay,
    items_json: input.itemsJson,
    updated_at: input.updatedAt,
  };
  const index = database.snapshots.findIndex((snapshot) => snapshot.cache_date === row.cache_date);
  if (index >= 0) database.snapshots[index] = row;
  else database.snapshots.push(row);
}

function isHotSnapshotInput(value: unknown): value is IHotSnapshotInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.cacheDate === 'string' &&
    (input.tradeDate === null || typeof input.tradeDate === 'string') &&
    typeof input.isPreviousTradeDay === 'number' &&
    typeof input.itemsJson === 'string' &&
    typeof input.updatedAt === 'string'
  );
}

beforeEach(async () => {
  database.snapshots = [];
  vi.resetModules();
  store = await import('../quote-store.js');
});

describe('热点 SQLite 快照', () => {
  it('空库不返回热点快照', () => {
    expect(store?.getLatestHotStockHintSnapshot()).toBeUndefined();
  });

  it('写入后完整回读真实热点及交易日', () => {
    const currentStore = store;
    if (!currentStore) throw new Error('quote store 未初始化');

    currentStore.saveHotStockHintSnapshot('2026-08-18', source());

    expect(currentStore.getLatestHotStockHintSnapshot()).toMatchObject({
      cacheDate: '2026-08-18',
      source: {
        tradeDate: '2026-08-18',
        isPreviousTradeDay: false,
        items: [expect.objectContaining({ code: '600519', name: '贵州茅台', tag: '封涨停板' })],
      },
    });
  });

  it('按缓存日期覆盖并读取最新日期快照', () => {
    const currentStore = store;
    if (!currentStore) throw new Error('quote store 未初始化');

    currentStore.saveHotStockHintSnapshot('2026-08-18', source({ tradeDate: '2026-08-15', isPreviousTradeDay: true }));
    currentStore.saveHotStockHintSnapshot('2026-08-18', source({ items: [], tradeDate: '2026-08-18' }));
    currentStore.saveHotStockHintSnapshot('2026-08-19', source({ tradeDate: '2026-08-19' }));

    expect(currentStore.getLatestHotStockHintSnapshot()).toMatchObject({
      cacheDate: '2026-08-19',
      source: { tradeDate: '2026-08-19', isPreviousTradeDay: false },
    });
    expect(database.snapshots).toHaveLength(2);
  });
});

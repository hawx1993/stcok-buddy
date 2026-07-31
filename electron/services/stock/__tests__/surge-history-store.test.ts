import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HotFocusItem, StockSurgeEvent } from '../../../../src/shared/types.js';

type TSurgeHistoryStore = typeof import('../surge-history-store.js');

let dbPath = '';
let store: TSurgeHistoryStore | undefined;

function removeDbFiles(target: string) {
  for (const suffix of ['', '.wal']) rmSync(`${target}${suffix}`, { force: true });
}

async function loadStore() {
  dbPath = path.join(os.tmpdir(), `stocksense-surge-vitest-${process.pid}-${Date.now()}-${Math.random()}.duckdb`);
  process.env.STOCKSENSE_SURGE_DB_PATH = dbPath;
  vi.resetModules();
  store = await import('../surge-history-store.js');
  return store;
}

function createItem(overrides: Partial<HotFocusItem> = {}): HotFocusItem {
  return {
    id: 'surge-1',
    title: '贵州茅台 600519',
    code: '600519',
    name: '贵州茅台',
    time: '10:01',
    price: '1500.00',
    changePercent: '+2.00%',
    turnover: '1.20%',
    amount: '买入1万手',
    description: '特大单买入',
    tag: '特大单买入',
    type: 'surge',
    ...overrides,
  };
}

beforeEach(async () => {
  await loadStore();
});

afterEach(async () => {
  if (store) {
    store.clearSurgeHistoryClearMarker();
    await store.closeSurgeHistoryStore(1000);
    await store.closeSurgeHistoryInstance();
  }
  if (dbPath) removeDbFiles(dbPath);
  delete process.env.STOCKSENSE_SURGE_DB_PATH;
  store = undefined;
  dbPath = '';
  vi.resetModules();
});

describe('异动历史 DuckDB 存储', () => {
  it('可以对队列快照去重并写入 DuckDB', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('surge history store not loaded');

    currentStore.enqueueSurgeSnapshot([
      createItem({ title: '队列写入前' }),
      createItem({ title: '队列写入后' }),
    ], new Date('2026-07-23T02:01:00.000Z'), '2026-07-23');

    expect(currentStore.getQueuedSurgeSnapshotCount()).toBe(1);
    expect(await currentStore.listSurgeHistory('2026-07-23', 0, 10)).toEqual([]);

    await currentStore.flushSurgeSnapshotQueue();

    expect(currentStore.getQueuedSurgeSnapshotCount()).toBe(0);
    expect(await currentStore.listSurgeHistory('2026-07-23', 0, 10)).toEqual([
      expect.objectContaining({ id: 'surge-1', title: '队列写入后' }),
    ]);
  });

  it('可以按日期和 ID 更新快照并支持排序分页', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('surge history store not loaded');

    await currentStore.saveSurgeSnapshot([
      createItem({ id: 'a', title: '旧标题', time: '10:01' }),
      createItem({ id: 'b', title: '中间事件', time: '10:02' }),
      createItem({ id: 'c', title: '最新事件', time: '10:03' }),
      createItem({ id: 'a', title: '新标题', time: '10:01' }),
    ], new Date('2026-07-24T02:30:00.000Z'), '2026-07-24');

    const firstPage = await currentStore.listSurgeHistory('2026-07-24', 0, 2);
    expect(firstPage.map((item) => item.id)).toEqual(['c', 'b']);
    expect(await currentStore.listSurgeHistory('2026-07-24', 2, 2)).toEqual([
      expect.objectContaining({ id: 'a', title: '新标题' }),
    ]);
    expect(await currentStore.listSurgeHistory('bad-date', 0, 10)).toEqual([]);
    expect(await currentStore.listSurgeDates(7)).toEqual(['2026-07-24']);
  });

  it('可以保存个股异动历史并对查询结果去重', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('surge history store not loaded');

    const events: StockSurgeEvent[] = [
      { ...createItem({ id: 'individual-1', time: '14:57', tag: '快速涨幅' }), tradeDate: '2026-07-24' },
      { ...createItem({ id: 'individual-1', time: '14:57', tag: '快速涨幅', title: '个股异动去重后' }), tradeDate: '2026-07-24' },
      { ...createItem({ id: 'individual-2', time: '14:57', tag: '快速涨幅', title: '重复信号' }), tradeDate: '2026-07-24' },
    ];
    await currentStore.saveIndividualSurgeHistory(events);

    const history = await currentStore.listSurgeHistory('2026-07-24', 0, 10);
    expect(history.some((item) => item.title === '个股异动去重后')).toBe(true);

    const stockEvents = await currentStore.listStockSurgeEvents('600519', 30);
    expect(stockEvents.filter((item) => item.time === '14:57' && item.tag === '快速涨幅')).toHaveLength(1);
    expect(stockEvents[0]).toMatchObject({ tradeDate: '2026-07-24', title: '重复信号' });
  });

  it('可以清理指定日期和全部历史并在清理标记期间阻止写入', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('surge history store not loaded');

    await currentStore.saveSurgeSnapshot([createItem({ id: 'd1' })], new Date('2026-07-23T02:00:00.000Z'), '2026-07-23');
    await currentStore.saveSurgeSnapshot([createItem({ id: 'd2' })], new Date('2026-07-24T02:00:00.000Z'), '2026-07-24');

    await currentStore.clearSurgeHistoryDate('2026-07-23');
    expect(await currentStore.listSurgeHistory('2026-07-23', 0, 10)).toEqual([]);
    expect(await currentStore.listSurgeHistory('2026-07-24', 0, 10)).toHaveLength(1);

    await currentStore.clearAllSurgeHistory();
    expect(await currentStore.listSurgeDates(7)).toEqual([]);

    currentStore.setSurgeHistoryClearMarker();
    expect(currentStore.isSurgeHistoryClearMarkerActive()).toBe(true);
    await currentStore.saveSurgeSnapshot([createItem({ id: 'blocked' })], new Date('2026-07-25T02:00:00.000Z'), '2026-07-25');
    currentStore.enqueueSurgeSnapshot([createItem({ id: 'queued-blocked' })], new Date('2026-07-25T02:01:00.000Z'), '2026-07-25');
    expect(currentStore.getQueuedSurgeSnapshotCount()).toBe(0);
    expect(await currentStore.listSurgeHistory('2026-07-25', 0, 10)).toEqual([]);
  });

  it('可以重置模块状态并写入新的 DuckDB 实例', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('surge history store not loaded');

    await currentStore.saveSurgeSnapshot([createItem({ id: 'before-reset' })], new Date('2026-07-23T02:00:00.000Z'), '2026-07-23');
    expect(await currentStore.listSurgeHistory('2026-07-23', 0, 10)).toHaveLength(1);

    await currentStore.resetSurgeHistoryStore();
    removeDbFiles(dbPath);
    await currentStore.saveSurgeSnapshot([createItem({ id: 'after-reset' })], new Date('2026-07-24T02:00:00.000Z'), '2026-07-24');

    expect(await currentStore.listSurgeHistory('2026-07-23', 0, 10)).toEqual([]);
    expect(await currentStore.listSurgeHistory('2026-07-24', 0, 10)).toEqual([
      expect.objectContaining({ id: 'after-reset' }),
    ]);
  });
});

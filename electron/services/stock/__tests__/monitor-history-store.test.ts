import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IMonitorEvent } from '../../../../src/shared/types.js';

type TMonitorHistoryStore = typeof import('../monitor-history-store.js');

let dbPath = '';
let store: TMonitorHistoryStore | undefined;

function removeDbFiles(target: string) {
  for (const suffix of ['', '.wal']) rmSync(`${target}${suffix}`, { force: true });
}

async function loadStore() {
  dbPath = path.join(os.tmpdir(), `stocksense-monitor-vitest-${process.pid}-${Date.now()}-${Math.random()}.duckdb`);
  process.env.STOCKSENSE_MONITOR_DB_PATH = dbPath;
  vi.resetModules();
  store = await import('../monitor-history-store.js');
  return store;
}

function createEvent(overrides: Partial<IMonitorEvent> = {}): IMonitorEvent {
  return {
    id: 'monitor-1',
    category: 'technical',
    timestamp: '2026-07-23T02:00:00.000Z',
    code: '600519',
    name: '贵州茅台',
    price: 1500.5,
    changePercent: 2.35,
    title: '日内涨幅走强',
    badge: '实时行情',
    details: ['当前涨跌幅 +2.35%', '日内区间 1480.00 - 1510.00'],
    aiAnalysis: '测试事件',
    chart: { type: 'line', data: [1, 2, 3], labels: ['a', 'b', 'c'] },
    score: 88,
    ...overrides,
  };
}

beforeEach(async () => {
  await loadStore();
});

afterEach(async () => {
  if (store) {
    await store.closeMonitorHistoryStore(1000);
    await store.closeMonitorHistoryInstance();
  }
  if (dbPath) removeDbFiles(dbPath);
  delete process.env.STOCKSENSE_MONITOR_DB_PATH;
  store = undefined;
  dbPath = '';
  vi.resetModules();
});

describe('AI 监控历史 DuckDB 存储', () => {
  it('可以保存监控事件并回读数值和 JSON 字段', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    const event = createEvent();
    await currentStore.saveMonitorEvents([event], new Date('2026-07-23T02:00:00.000Z'), '2026-07-23');

    const rows = await currentStore.listMonitorHistory({ date: '2026-07-23', categories: ['technical'], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: event.id,
      category: event.category,
      timestamp: event.timestamp,
      code: event.code,
      name: event.name,
      price: event.price,
      changePercent: event.changePercent,
      title: event.title,
      badge: event.badge,
      details: event.details,
      aiAnalysis: event.aiAnalysis,
      chart: event.chart,
      score: event.score,
    });
  });

  it('可以对队列事件去重并写入 DuckDB', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    currentStore.enqueueMonitorEvents([
      createEvent({ id: 'queued-1', title: '队列写入前' }),
      createEvent({ id: 'queued-1', title: '队列写入后' }),
    ], new Date('2026-07-23T02:01:00.000Z'), '2026-07-23');

    expect(currentStore.getQueuedMonitorEventCount()).toBe(1);
    expect(await currentStore.listMonitorHistory({ date: '2026-07-23', limit: 10 })).toEqual([]);

    await currentStore.flushMonitorEventQueue();

    expect(currentStore.getQueuedMonitorEventCount()).toBe(0);
    expect(await currentStore.listMonitorHistory({ date: '2026-07-23', limit: 10 })).toEqual([
      expect.objectContaining({ id: 'queued-1', title: '队列写入后', timestamp: '2026-07-23T02:00:00.000Z' }),
    ]);
  });

  it('可以更新相同 ID 并保留首次时间戳', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    await currentStore.saveMonitorEvents([
      createEvent({ id: 'stable-time', category: 'large-order', timestamp: '2026-07-23T02:10:00.000Z', title: '首次生成' }),
    ], new Date('2026-07-23T02:10:00.000Z'), '2026-07-23');
    await currentStore.saveMonitorEvents([
      createEvent({ id: 'stable-time', category: 'large-order', timestamp: '2026-07-23T02:11:00.000Z', title: '更新内容' }),
    ], new Date('2026-07-23T02:11:00.000Z'), '2026-07-23');

    const row = (await currentStore.listMonitorHistory({ date: '2026-07-23', categories: ['large-order'], limit: 10 }))[0];
    expect(row).toMatchObject({ id: 'stable-time', title: '更新内容', timestamp: '2026-07-23T02:10:00.000Z' });
  });

  it('可以按分类代码标题去重高频信号', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    await currentStore.saveMonitorEvents([
      createEvent({ id: 'stable-signal-1', category: 'ai-opportunity', code: '300001', title: '强势量价机会', timestamp: '2026-07-23T02:20:00.000Z' }),
    ], new Date('2026-07-23T02:20:00.000Z'), '2026-07-23');
    await currentStore.saveMonitorEvents([
      createEvent({ id: 'stable-signal-2', category: 'ai-opportunity', code: '300001', title: '强势量价机会', timestamp: '2026-07-23T02:21:00.000Z' }),
    ], new Date('2026-07-23T02:21:00.000Z'), '2026-07-23');

    const rows = await currentStore.listMonitorHistory({ date: '2026-07-23', categories: ['ai-opportunity'], limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'stable-signal-2', timestamp: '2026-07-23T02:20:00.000Z' });
  });

  it('可以列出日期、按分类过滤、分页并统计历史记录', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    await currentStore.saveMonitorEvents([
      createEvent({ id: 'technical-1', category: 'technical', timestamp: '2026-07-23T02:00:00.000Z' }),
      createEvent({ id: 'news-1', category: 'news', timestamp: '2026-07-23T02:01:00.000Z', title: '公告更新' }),
      createEvent({ id: 'technical-2', category: 'technical', timestamp: '2026-07-23T02:02:00.000Z', title: '技术信号二' }),
    ], new Date('2026-07-23T02:02:00.000Z'), '2026-07-23');
    await currentStore.saveMonitorEvents([
      createEvent({ id: 'older-news', category: 'news', timestamp: '2026-07-22T02:00:00.000Z', title: '前日新闻' }),
    ], new Date('2026-07-22T02:00:00.000Z'), '2026-07-22');

    expect(await currentStore.listMonitorDates(7)).toEqual(['2026-07-23', '2026-07-22']);
    expect(await currentStore.listMonitorHistory({ date: 'bad-date', limit: 10 })).toEqual([]);

    const technical = await currentStore.listMonitorHistory({ date: '2026-07-23', categories: ['technical'], limit: 10 });
    expect(technical.map((item) => item.id)).toEqual(['technical-2', 'technical-1']);

    const secondRow = await currentStore.listMonitorHistory({ date: '2026-07-23', offset: 1, limit: 1 });
    expect(secondRow).toHaveLength(1);
    expect(secondRow[0].id).toBe('news-1');

    expect(await currentStore.countMonitorHistory({ date: '2026-07-23' })).toBe(3);
    expect(await currentStore.countMonitorHistoryByCategory({ date: '2026-07-23' })).toEqual({ news: 1, technical: 2 });
  });

  it('可以裁剪旧日期并清理弱监控信号噪音', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    for (let index = 1; index <= 8; index += 1) {
      const date = `2026-07-${String(10 + index).padStart(2, '0')}`;
      await currentStore.saveMonitorEvents([createEvent({ id: `older-${index}`, timestamp: `${date}T02:00:00.000Z` })], new Date(`${date}T02:00:00.000Z`), date);
    }
    await currentStore.pruneMonitorHistory(7);
    expect(await currentStore.listMonitorDates(20)).toHaveLength(7);

    await currentStore.saveMonitorEvents([
      createEvent({ id: 'weak-opp', category: 'ai-opportunity', timestamp: '2026-07-26T02:00:00.000Z', code: '300001', title: '强势量价机会', changePercent: 3.2 }),
      createEvent({ id: 'strong-opp', category: 'ai-opportunity', timestamp: '2026-07-26T02:01:00.000Z', code: '300002', title: '强势量价机会', changePercent: 5.2 }),
      createEvent({ id: 'weak-warn', category: 'ai-warning', timestamp: '2026-07-26T02:02:00.000Z', code: '300003', title: '日内回撤风险', changePercent: -3.2 }),
      createEvent({ id: 'strong-warn', category: 'ai-warning', timestamp: '2026-07-26T02:03:00.000Z', code: '300004', title: '日内回撤风险', changePercent: -5.2 }),
      createEvent({ id: 'news-keep-1', category: 'news', timestamp: '2026-07-26T02:04:00.000Z', code: '300005', title: '新闻事件', changePercent: 0 }),
      createEvent({ id: 'news-keep-2', category: 'news', timestamp: '2026-07-26T02:05:00.000Z', code: '300005', title: '新闻事件', changePercent: 0 }),
    ], new Date('2026-07-26T02:05:00.000Z'), '2026-07-26');
    await currentStore.cleanupMonitorHistoryNoise('2026-07-26');

    const cleaned = await currentStore.listMonitorHistory({ date: '2026-07-26', limit: 20 });
    expect(cleaned.some((item) => item.id === 'weak-opp')).toBe(false);
    expect(cleaned.some((item) => item.id === 'weak-warn')).toBe(false);
    expect(cleaned.some((item) => item.id === 'strong-opp')).toBe(true);
    expect(cleaned.some((item) => item.id === 'strong-warn')).toBe(true);
    expect(cleaned.filter((item) => item.category === 'news')).toHaveLength(2);
  });

  it('可以重置模块状态并写入新的 DuckDB 实例', async () => {
    const currentStore = store;
    if (!currentStore) throw new Error('monitor history store not loaded');

    await currentStore.saveMonitorEvents([createEvent({ id: 'before-reset' })], new Date('2026-07-23T02:00:00.000Z'), '2026-07-23');
    expect(await currentStore.countMonitorHistory({ date: '2026-07-23' })).toBe(1);

    await currentStore.resetMonitorHistoryStore();
    removeDbFiles(dbPath);
    await currentStore.saveMonitorEvents([createEvent({ id: 'after-reset' })], new Date('2026-07-24T02:00:00.000Z'), '2026-07-24');

    expect(await currentStore.countMonitorHistory({ date: '2026-07-23' })).toBe(0);
    expect(await currentStore.listMonitorHistory({ date: '2026-07-24', limit: 10 })).toEqual([
      expect.objectContaining({ id: 'after-reset' }),
    ]);
  });
});

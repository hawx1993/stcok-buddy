import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { IMonitorEvent } from '../../src/shared/types.js';

const dbPath = path.join(os.tmpdir(), `stocksense-monitor-selfcheck-${process.pid}.duckdb`);
process.env.STOCKSENSE_MONITOR_DB_PATH = dbPath;

const store = await import('../services/stock/monitor-history-store.js');

const baseEvent: IMonitorEvent = {
  id: 'selfcheck-1',
  category: 'technical',
  timestamp: '2026-07-23T02:00:00.000Z',
  code: '600519',
  name: '贵州茅台',
  price: 1500.5,
  changePercent: 2.35,
  title: '日内涨幅走强',
  badge: '实时行情',
  details: ['当前涨跌幅 +2.35%', '日内区间 1480.00 - 1510.00'],
  aiAnalysis: '自检事件',
  chart: { type: 'line', data: [1, 2, 3], labels: ['a', 'b', 'c'] },
  score: 88,
};

await store.saveMonitorEvents([baseEvent], new Date('2026-07-23T02:00:00.000Z'), '2026-07-23');
await store.saveMonitorEvents([
  { ...baseEvent, id: 'selfcheck-2', category: 'news', timestamp: '2026-07-22T02:00:00.000Z', title: '公告更新' },
], new Date('2026-07-22T02:00:00.000Z'), '2026-07-22');

store.enqueueMonitorEvents([
  { ...baseEvent, id: 'queued-1', title: '队列写入前' },
  { ...baseEvent, id: 'queued-1', title: '队列写入后' },
], new Date('2026-07-23T02:01:00.000Z'), '2026-07-23');
assert.equal(store.getQueuedMonitorEventCount(), 1);
assert.equal((await store.listMonitorHistory({ date: '2026-07-23', limit: 10 })).some((item) => item.id === 'queued-1'), false);
await store.flushMonitorEventQueue();
assert.equal(store.getQueuedMonitorEventCount(), 0);
const queued = await store.listMonitorHistory({ date: '2026-07-23', limit: 10 });
assert.equal(queued.find((item) => item.id === 'queued-1')?.title, '队列写入后');
assert.equal(queued.find((item) => item.id === 'queued-1')?.timestamp, baseEvent.timestamp);

await store.saveMonitorEvents([
  { ...baseEvent, id: 'stable-time', category: 'large-order', timestamp: '2026-07-23T02:10:00.000Z', title: '首次生成' },
], new Date('2026-07-23T02:10:00.000Z'), '2026-07-23');
await store.saveMonitorEvents([
  { ...baseEvent, id: 'stable-time', category: 'large-order', timestamp: '2026-07-23T02:11:00.000Z', title: '更新内容' },
], new Date('2026-07-23T02:11:00.000Z'), '2026-07-23');
const stableTime = (await store.listMonitorHistory({ date: '2026-07-23', limit: 10 })).find((item) => item.id === 'stable-time');
assert.equal(stableTime?.title, '更新内容');
assert.equal(stableTime?.timestamp, '2026-07-23T02:10:00.000Z');

const dates = await store.listMonitorDates(7);
assert.deepEqual(dates, ['2026-07-23', '2026-07-22']);

const technical = await store.listMonitorHistory({ date: '2026-07-23', categories: ['technical'], limit: 10 });
assert.equal(technical.length, 2);
assert.equal(technical.some((item) => item.id === 'selfcheck-1'), true);
const selfcheck = technical.find((item) => item.id === 'selfcheck-1');
assert.equal(selfcheck?.price, 1500.5);
assert.equal(selfcheck?.changePercent, 2.35);
assert.deepEqual(selfcheck?.details, baseEvent.details);
assert.deepEqual(selfcheck?.chart, baseEvent.chart);
assert.equal(selfcheck?.score, 88);

const news = await store.listMonitorHistory({ date: '2026-07-23', categories: ['news'], limit: 10 });
assert.equal(news.length, 0);

for (let i = 1; i <= 8; i += 1) {
  const date = `2026-07-${String(10 + i).padStart(2, '0')}`;
  await store.saveMonitorEvents([{ ...baseEvent, id: `older-${i}`, timestamp: `${date}T02:00:00.000Z` }], new Date(`${date}T02:00:00.000Z`), date);
}
await store.pruneMonitorHistory(7);
assert.equal((await store.listMonitorDates(20)).length, 7);

const historyPageEvents: IMonitorEvent[] = Array.from({ length: 1280 }, (_, index) => ({
  ...baseEvent,
  id: `history-page-${String(index + 1).padStart(4, '0')}`,
  timestamp: `2026-07-24T${String(Math.floor(index / 360)).padStart(2, '0')}:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  title: `分页历史 ${index + 1}`,
}));
await store.saveMonitorEvents(historyPageEvents, new Date('2026-07-24T02:00:00.000Z'), '2026-07-24');
assert.equal(await store.countMonitorHistory({ date: '2026-07-24' }), 1280);
assert.equal((await store.countMonitorHistoryByCategory({ date: '2026-07-24' })).technical, 1280);
const pageFiftySix = await store.listMonitorHistory({ date: '2026-07-24', offset: 1100, limit: 20 });
assert.equal(pageFiftySix.length, 20);
assert.equal(pageFiftySix[0].id, 'history-page-0180');
const lastPage = await store.listMonitorHistory({ date: '2026-07-24', offset: 1260, limit: 20 });
assert.equal(lastPage.length, 20);
assert.equal(lastPage[19].id, 'history-page-0001');

const repeatedWarnings: IMonitorEvent[] = Array.from({ length: 100 }, (_, index) => ({
  ...baseEvent,
  id: `repeat-warning-${index}`,
  category: 'ai-warning',
  timestamp: `2026-07-25T02:00:${String(index).padStart(2, '0')}.000Z`,
  code: '002384',
  name: '东山精密',
  changePercent: -5.2,
  title: '日内回撤风险',
  badge: '强预警',
}));
await store.saveMonitorEvents(repeatedWarnings, new Date('2026-07-25T02:02:00.000Z'), '2026-07-25');
const dedupedWarnings = await store.listMonitorHistory({ date: '2026-07-25', categories: ['ai-warning'], limit: 10 });
assert.equal(dedupedWarnings.length, 1);
assert.equal(dedupedWarnings[0].id, 'repeat-warning-99');

await store.saveMonitorEvents([
  { ...baseEvent, id: 'weak-opp', category: 'ai-opportunity', timestamp: '2026-07-26T02:00:00.000Z', code: '300001', title: '强势量价机会', changePercent: 3.2 },
  { ...baseEvent, id: 'strong-opp', category: 'ai-opportunity', timestamp: '2026-07-26T02:01:00.000Z', code: '300002', title: '强势量价机会', changePercent: 5.2 },
  { ...baseEvent, id: 'weak-warn', category: 'ai-warning', timestamp: '2026-07-26T02:02:00.000Z', code: '300003', title: '日内回撤风险', changePercent: -3.2 },
  { ...baseEvent, id: 'strong-warn', category: 'ai-warning', timestamp: '2026-07-26T02:03:00.000Z', code: '300004', title: '日内回撤风险', changePercent: -5.2 },
  { ...baseEvent, id: 'news-keep-1', category: 'news', timestamp: '2026-07-26T02:04:00.000Z', code: '300005', title: '新闻事件', changePercent: 0 },
  { ...baseEvent, id: 'news-keep-2', category: 'news', timestamp: '2026-07-26T02:05:00.000Z', code: '300005', title: '新闻事件', changePercent: 0 },
], new Date('2026-07-26T02:05:00.000Z'), '2026-07-26');
await store.cleanupMonitorHistoryNoise('2026-07-26');
const cleaned = await store.listMonitorHistory({ date: '2026-07-26', limit: 20 });
assert.equal(cleaned.some((item) => item.id === 'weak-opp'), false);
assert.equal(cleaned.some((item) => item.id === 'weak-warn'), false);
assert.equal(cleaned.some((item) => item.id === 'strong-opp'), true);
assert.equal(cleaned.some((item) => item.id === 'strong-warn'), true);
assert.equal(cleaned.filter((item) => item.category === 'news').length, 2);

await store.closeMonitorHistoryStore(1000);
await store.closeMonitorHistoryInstance();
rmSync(dbPath, { force: true });
app.quit();

console.log('monitor-history-store selfcheck passed');

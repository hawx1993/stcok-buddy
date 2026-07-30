import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { IMonitorEvent } from '../../../src/shared/types.js';

const dbPath = path.join(os.tmpdir(), `stocksense-monitor-selfcheck-${process.pid}.duckdb`);
process.env.STOCKSENSE_MONITOR_DB_PATH = dbPath;

const store = await import('./monitor-history-store.js');

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

const historyPageEvents: IMonitorEvent[] = Array.from({ length: 360 }, (_, index) => ({
  ...baseEvent,
  id: `history-page-${String(index + 1).padStart(3, '0')}`,
  timestamp: `2026-07-24T02:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  title: `分页历史 ${index + 1}`,
}));
await store.saveMonitorEvents(historyPageEvents, new Date('2026-07-24T02:00:00.000Z'), '2026-07-24');
const allHistoryPageEvents = await store.listMonitorHistory({ date: '2026-07-24', limit: 1000 });
assert.equal(allHistoryPageEvents.length, 360);
assert.equal(await store.countMonitorHistory({ date: '2026-07-24' }), 360);
const pageThirteen = await store.listMonitorHistory({ date: '2026-07-24', offset: 240, limit: 20 });
assert.equal(pageThirteen.length, 20);
assert.equal(pageThirteen[0].id, 'history-page-120');

await store.closeMonitorHistoryStore(1000);
await store.closeMonitorHistoryInstance();
rmSync(dbPath, { force: true });
app.quit();

console.log('monitor-history-store selfcheck passed');

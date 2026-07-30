import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { isChinaMarketOpen } from '../../../src/shared/market-time.js';
import type { HotFocusItem } from '../../../src/shared/types.js';

const dbPath = path.join(os.tmpdir(), `stocksense-surge-selfcheck-${process.pid}.duckdb`);
process.env.STOCKSENSE_SURGE_DB_PATH = dbPath;

assert.equal(isChinaMarketOpen(new Date('2026-07-23T01:24:00.000Z')), false);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T01:25:00.000Z')), true);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T01:30:00.000Z')), true);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T03:30:00.000Z')), true);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T04:30:00.000Z')), false);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T07:01:00.000Z')), false);
assert.equal(isChinaMarketOpen(new Date('2026-07-25T01:30:00.000Z')), false);

const store = await import('./surge-history-store.js');
const scheduler = await import('./surge-history-scheduler.js');

const item: HotFocusItem = {
  id: 'surge-selfcheck-1',
  title: '贵州茅台 600519',
  code: '600519',
  name: '贵州茅台',
  time: '10:01',
  price: '1500.00',
  changePercent: '+2.00%',
  amount: '买入1万手',
  description: '特大单买入',
  tag: '特大单买入',
  type: 'surge',
};

store.enqueueSurgeSnapshot([
  { ...item, title: '队列写入前' },
  { ...item, title: '队列写入后' },
], new Date('2026-07-23T02:01:00.000Z'), '2026-07-23');
assert.equal(store.getQueuedSurgeSnapshotCount(), 1);
assert.equal((await store.listSurgeHistory('2026-07-23', 0, 10)).length, 0);
await store.flushSurgeSnapshotQueue();
assert.equal(store.getQueuedSurgeSnapshotCount(), 0);
const rows = await store.listSurgeHistory('2026-07-23', 0, 10);
assert.equal(rows.length, 1);
assert.equal(rows[0].title, '队列写入后');

scheduler.ensureSurgeHistoryCapture();
scheduler.ensureSurgeHistoryCapture();
assert.equal(scheduler.isSurgeHistorySchedulerRunning(), true);
scheduler.stopSurgeHistoryScheduler();
assert.equal(scheduler.isSurgeHistorySchedulerRunning(), false);
await scheduler.waitForSurgeHistoryScheduler();

await store.closeSurgeHistoryStore(1000);
await store.closeSurgeHistoryInstance();
rmSync(dbPath, { force: true });
app.quit();

console.log('surge-monitor selfcheck passed');

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dbPath = path.join(os.tmpdir(), `stocksense-market-selfcheck-${process.pid}.duckdb`);
process.env.STOCKSENSE_MARKET_DB_PATH = dbPath;

const store = await import('./market-data-store.js');
const query = await import('./market-data-query.js');
const quality = await import('./quality.js');
const sync = await import('./market-data-sync.js');

await store.initializeMarketDataStore();
await store.initializeMarketDataStore();

await store.createSyncJob({ id: 'selfcheck-sync-job', jobType: 'daily_incremental', targetTradeDate: '2026-07-09', totalSymbols: 1 });

const now = new Date().toISOString();
const bar = {
  symbol: '600519', tradeDate: '2026-07-09', open: 1500, high: 1520, low: 1490, close: 1510,
  volume: 1000, amount: 10_000_000, adjustType: 'qfq' as const, source: 'selfcheck', fetchedAt: now,
};
await store.upsertDailyBars([bar, bar]);
assert.equal((await store.listDailyBars('600519', { adjustType: 'qfq' })).length, 1);

await store.upsertDailyBars([{ ...bar, adjustType: 'none', close: 1505 }]);
assert.equal((await store.listDailyBars('600519', { adjustType: 'none' }))[0].close, 1505);
assert.equal((await store.listDailyBars('600519', { adjustType: 'qfq' }))[0].close, 1510);

assert(quality.validateDailyBar({ ...bar, high: 1400 }));
assert(quality.validateDailyBar({ ...bar, volume: -1 }));

let remoteCalls = 0;
query.setHistoricalProvidersForTest([{
  name: 'mock',
  async getDailyBars(symbol, options) {
    remoteCalls += 1;
    return [{ ...bar, symbol, tradeDate: options.startDate ?? '2026-07-08' }];
  },
}]);

const local = await query.queryHistoricalBars('600519', { limit: 1, adjustType: 'qfq' });
assert.equal(local.meta.storage, 'local');
assert.equal(remoteCalls, 0);

const filled = await query.queryHistoricalBars('000001', { startDate: '2026-07-08', endDate: '2026-07-08', adjustType: 'qfq' });
assert.equal(remoteCalls, 1);
assert.equal(filled.data.length, 1);

query.setHistoricalProvidersForTest([{ name: 'failure', async getDailyBars() { throw new Error('offline'); } }]);
const stale = await query.queryHistoricalBars('000002', { limit: 1, adjustType: 'qfq' });
assert.equal(stale.meta.isComplete, false);
assert(stale.meta.warnings.some((warning) => warning.includes('offline')));

const beforeClose = await sync.determineTargetTradeDate(new Date('2026-07-10T10:00:00+08:00'));
assert(beforeClose < '2026-07-10');

const quote = await query.queryLatestQuote('600519', async () => { throw new Error('offline'); });
assert.equal(quote.meta.freshness, 'stale');
assert.equal(quote.meta.isComplete, false);

await store.closeMarketDataStore();
for (const suffix of ['', '.wal']) {
  try { rmSync(`${dbPath}${suffix}`); } catch { /* already removed */ }
}
console.log('market-data selfcheck passed');

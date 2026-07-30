import assert from 'node:assert/strict';
import type { KlinePoint, MarketIndexPeriod, MarketIndexSnapshot } from '../../src/shared/types.js';
import { getMarketPageSnapshot } from '../services/stock/market-page.js';
import { getKline } from '../services/stock/stock-client.js';

const periods = ['1d', '1w', '1mo'] as const;
const symbols = ['sh000001', 'sz399001'] as const;
const symbolNames: Record<(typeof symbols)[number], string> = {
  sh000001: '上证指数',
  sz399001: '深证成指',
};
const snapshotCodes: Record<(typeof symbols)[number], string> = {
  sh000001: '000001',
  sz399001: '399001',
};
const directRows = new Map<string, KlinePoint[]>();

function klineLimit(period: (typeof periods)[number]) {
  return period === '1d' ? 360 : period === '1w' ? 240 : 120;
}

for (const symbol of symbols) {
  for (const period of periods) {
    const rows = await getKline(symbol, klineLimit(period), period);
    const label = `${symbol} ${period}`;
    assertKlineRows(rows, label);
    assertLatestKlineRow(rows, label);
    directRows.set(`${symbol}:${period}`, rows);
  }
}

for (const period of periods) {
  const snapshot = await getMarketPageSnapshot('sh-main', period as MarketIndexPeriod);
  for (const symbol of symbols) {
    const index = snapshot.indices.find((item) => item.code === snapshotCodes[symbol]);
    assert(index, `market snapshot ${period} should include ${symbolNames[symbol]}`);
    const label = `market snapshot ${symbolNames[symbol]} ${period}`;
    assertKlineRows(index.minutes, label);
    assertLatestKlineRow(index.minutes, label);
    assertSnapshotLatestBar(index, directRows.get(`${symbol}:${period}`) ?? [], label);
  }
}

function assertKlineRows(rows: KlinePoint[], label: string) {
  assert(rows.length > 0, `${label} should return index K-line rows`);
  let previousTimestamp = 0;
  for (const row of rows) {
    assert(Number.isFinite(row.open), `${label} open should be finite`);
    assert(Number.isFinite(row.high), `${label} high should be finite`);
    assert(Number.isFinite(row.low), `${label} low should be finite`);
    assert(Number.isFinite(row.close), `${label} close should be finite`);
    assert(row.high > 1000, `${label} high should look like an index value`);
    assert(row.low > 1000, `${label} low should look like an index value`);
    assert(row.close > 1000, `${label} close should look like an index value`);
    if (row.timestamp !== undefined) {
      assert(row.timestamp >= previousTimestamp, `${label} timestamps should be ascending`);
      previousTimestamp = row.timestamp;
    }
  }
}

function assertLatestKlineRow(rows: KlinePoint[], label: string) {
  const latest = rows.at(-1);
  assert(latest, `${label} should include latest row`);
  assert(latest.high >= Math.max(latest.open, latest.close), `${label} latest high should cover open/close`);
  assert(latest.low <= Math.min(latest.open, latest.close), `${label} latest low should cover open/close`);
}

function assertSnapshotLatestBar(index: MarketIndexSnapshot, expectedRows: KlinePoint[], label: string) {
  const latest = index.minutes.at(-1);
  const expected = expectedRows.at(-1);
  if (!latest || !expected || latest.time !== expected.time) return;
  assert.equal(latest.high, expected.high, `${label} latest high should keep period K-line value`);
  assert.equal(latest.low, expected.low, `${label} latest low should keep period K-line value`);
}

console.log('index-kline selfcheck passed');

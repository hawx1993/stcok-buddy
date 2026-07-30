import assert from 'node:assert/strict';
import type { KlinePoint, MarketIndexPeriod } from '../../src/shared/types.js';
import { getMarketPageSnapshot } from '../services/stock/market-page.js';
import { getKline } from '../services/stock/stock-client.js';

const periods = ['1d', '1w', '1mo'] as const;
const symbols = ['sh000001', 'sz399001'] as const;

for (const symbol of symbols) {
  for (const period of periods) {
    const rows = await getKline(symbol, 5, period);
    assertKlineRows(rows, `${symbol} ${period}`);
  }
}

for (const period of periods) {
  const snapshot = await getMarketPageSnapshot('sh-main', period as MarketIndexPeriod);
  const shIndex = snapshot.indices.find((item) => item.code === '000001');
  const szIndex = snapshot.indices.find((item) => item.code === '399001');
  assert(shIndex, `market snapshot ${period} should include 上证指数`);
  assert(szIndex, `market snapshot ${period} should include 深证成指`);
  assertKlineRows(shIndex.minutes, `market snapshot 上证指数 ${period}`);
  assertKlineRows(szIndex.minutes, `market snapshot 深证成指 ${period}`);
}

function assertKlineRows(rows: KlinePoint[], label: string) {
  assert(rows.length > 0, `${label} should return index K-line rows`);
  for (const row of rows) {
    assert(Number.isFinite(row.open), `${label} open should be finite`);
    assert(Number.isFinite(row.high), `${label} high should be finite`);
    assert(Number.isFinite(row.low), `${label} low should be finite`);
    assert(Number.isFinite(row.close), `${label} close should be finite`);
  }
}

console.log('index-kline selfcheck passed');

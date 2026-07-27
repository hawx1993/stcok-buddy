import assert from 'node:assert/strict';
import type { MarketQuoteRow } from '../../../src/shared/types.js';
import { applyMarketRowUpdateBatch, sameMarketRows } from '../../../src/components/market-view/market-row-updates.js';
import { findShenwanLevelTwoNodes } from './industry-provider.js';

const currentRows: MarketQuoteRow[] = Array.from({ length: 8 }, (_, index) => ({
  code: String(index + 1).padStart(6, '0'),
  name: `股票${index + 1}`,
  price: 10 + index,
  changePercent: 8 - index,
}));
const targetRows = [...currentRows]
  .reverse()
  .map((row, index) => ({ ...row, price: Number(row.price) + 1, changePercent: index + 1 }));

const firstBatch = applyMarketRowUpdateBatch(currentRows, targetRows);
assert(firstBatch.changedCodes.length <= 4);
assert(!sameMarketRows(firstBatch.rows, targetRows));
assert(firstBatch.movedCodes.length > 0);

let rows = currentRows;
let batchCount = 0;
while (!sameMarketRows(rows, targetRows) && batchCount < 10) {
  const batch = applyMarketRowUpdateBatch(rows, targetRows);
  assert(batch.changedCodes.length <= 4);
  rows = batch.rows;
  batchCount += 1;
}
assert(sameMarketRows(rows, targetRows));
assert(batchCount > 1);

const stableOrderBatch = applyMarketRowUpdateBatch(currentRows, targetRows, 10, false);
assert.deepEqual(stableOrderBatch.rows.map((row) => row.code), currentRows.map((row) => row.code));
assert.equal(stableOrderBatch.movedCodes.length, 0);
assert(!sameMarketRows(stableOrderBatch.rows, targetRows));

const valueOnlyTarget = currentRows.map((row, index) => index < 6 ? { ...row, price: Number(row.price) + 0.5 } : row);
const valueBatch = applyMarketRowUpdateBatch(currentRows, valueOnlyTarget);
assert.equal(valueBatch.changedCodes.length, 4);
assert.deepEqual(valueBatch.rows.slice(4), currentRows.slice(4));

const unchanged = applyMarketRowUpdateBatch(currentRows, currentRows);
assert.equal(unchanged.rows, currentRows);
assert.deepEqual(unchanged.changedCodes, []);

const industryRows: MarketQuoteRow[] = [
  { code: '600000', name: '浦发银行', price: 10, changePercent: 0, industry: '股份制银行' },
  { code: '600004', name: '白云机场', price: 11, changePercent: 0, industry: '航空机场' },
];
const missingIndustryTarget = industryRows.map((row) => ({
  code: row.code,
  name: row.name,
  price: Number(row.price) + 1,
  changePercent: row.changePercent,
}));
const industryBatch = applyMarketRowUpdateBatch(industryRows, missingIndustryTarget, 10);
assert.equal(industryBatch.pending, false);
assert.deepEqual(industryBatch.rows.map((row) => row.industry), ['股份制银行', '航空机场']);

const industryFillCurrentRows: MarketQuoteRow[] = Array.from({ length: 8 }, (_, index) => ({
  code: String(600000 + index),
  name: `股票${index + 1}`,
  price: 10 + index,
  changePercent: 0,
}));
const industryFillTargetRows = industryFillCurrentRows.map((row, index) => ({ ...row, industry: `行业${index + 1}` }));
const industryFillBatch = applyMarketRowUpdateBatch(industryFillCurrentRows, industryFillTargetRows);
assert.equal(industryFillBatch.pending, false);
assert.equal(industryFillBatch.changedCodes.length, 8);
assert.deepEqual(industryFillBatch.rows.map((row) => row.industry), industryFillTargetRows.map((row) => row.industry));

const nodes = findShenwanLevelTwoNodes([
  '行情中心',
  ['A股', [['申万二级', [['白酒Ⅱ', '', 'sw2_340500'], ['无效节点', '', 'new_test']], '']]],
]);
assert.deepEqual(nodes, [{ name: '白酒Ⅱ', code: 'sw2_340500' }]);

console.log('market-page selfcheck passed');

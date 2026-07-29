import assert from 'node:assert/strict';
import type { MarketQuoteRow } from '../../../src/shared/types.js';
import { applyMarketRowValueUpdate, sameMarketRows } from '../../../src/components/market-view/market-row-updates.js';
import { findShenwanLevelTwoNodes } from './industry-provider.js';

const currentRows: MarketQuoteRow[] = Array.from({ length: 8 }, (_, index) => ({
  code: String(index + 1).padStart(6, '0'),
  name: `股票${index + 1}`,
  price: 10 + index,
  changePercent: 8 - index,
}));

// ── Empty current → all target rows are new ──
const emptyBatch = applyMarketRowValueUpdate([], currentRows);
assert.deepEqual(emptyBatch.rows, currentRows);
assert.deepEqual(emptyBatch.changedCodes.sort(), currentRows.map((row) => row.code).sort());

// ── Same rows → no changes, same identity ──
const unchanged = applyMarketRowValueUpdate(currentRows, currentRows);
assert.deepEqual(unchanged.rows, currentRows);
assert.deepEqual(unchanged.changedCodes, []);

// ── Price-only changes detected ──
const valueOnlyTarget = currentRows.map((row, index) =>
  index < 6 ? { ...row, price: Number(row.price) + 0.5 } : row,
);
const valueBatch = applyMarketRowValueUpdate(currentRows, valueOnlyTarget);
assert.equal(valueBatch.changedCodes.length, 6);
// Unchanged tail rows keep same object identity
for (let i = 6; i < 8; i++) assert.equal(valueBatch.rows[i], currentRows[i]);

// ── Reversed rows with value changes → values update in current order ──
const targetRows: MarketQuoteRow[] = [...currentRows]
  .reverse()
  .map((row, index) => ({ ...row, price: Number(row.price) + 1, changePercent: index + 1 }));
const fullBatch = applyMarketRowValueUpdate(currentRows, targetRows);
assert.equal(fullBatch.changedCodes.length, 8);
// Values updated to match target but order preserved (current order)
for (const row of fullBatch.rows) {
  const target = targetRows.find((t) => t.code === row.code)!;
  assert.equal(row.price, target.price);
  assert.equal(row.changePercent, target.changePercent);
}

// ── New row appended, existing row deleted ──
const withNewAndDeleted: MarketQuoteRow[] = [
  { code: '000002', name: '股票2', price: 11, changePercent: 7 },
  { code: '000003', name: '股票3', price: 12, changePercent: 6 },
  { code: '000009', name: '股票9', price: 18, changePercent: 0 },
];
const deltaBatch = applyMarketRowValueUpdate(currentRows, withNewAndDeleted);
assert.deepEqual(deltaBatch.rows.map((row) => row.code), ['000002', '000003', '000009']);

// ── Industry preservation: target missing industry keeps current value ──
const industryRows: MarketQuoteRow[] = [
  { code: '600000', name: '浦发银行', price: 10, changePercent: 0, industry: '股份制银行' },
  { code: '600004', name: '白云机场', price: 11, changePercent: 0, industry: '航空机场' },
];
const missingIndustryTarget: MarketQuoteRow[] = industryRows.map((row) => ({
  code: row.code,
  name: row.name,
  price: Number(row.price) + 1,
  changePercent: row.changePercent,
}));
const industryBatch = applyMarketRowValueUpdate(industryRows, missingIndustryTarget);
assert.deepEqual(industryBatch.rows.map((row) => row.industry), ['股份制银行', '航空机场']);

// ── Industry fill: target provides industry when current has none ──
const noIndustryRows: MarketQuoteRow[] = Array.from({ length: 4 }, (_, index) => ({
  code: String(600000 + index),
  name: `股票${index + 1}`,
  price: 10 + index,
  changePercent: 0,
}));
const withIndustryTarget = noIndustryRows.map((row, index) => ({ ...row, industry: `行业${index + 1}` }));
const fillBatch = applyMarketRowValueUpdate(noIndustryRows, withIndustryTarget);
assert.deepEqual(fillBatch.rows.map((row) => row.industry), ['行业1', '行业2', '行业3', '行业4']);
assert.equal(fillBatch.changedCodes.length, 4);

// ── sameMarketRows ──
assert(sameMarketRows(currentRows, currentRows));
const differentRows = currentRows.map((row, index) => (index === 0 ? { ...row, price: 999 } : row));
assert(!sameMarketRows(currentRows, differentRows));

// ── Industry provider ──
const nodes = findShenwanLevelTwoNodes([
  '行情中心',
  ['A股', [['申万二级', [['白酒Ⅱ', '', 'sw2_340500'], ['无效节点', '', 'new_test']], '']]],
]);
assert.deepEqual(nodes, [{ name: '白酒Ⅱ', code: 'sw2_340500' }]);

console.log('market-page selfcheck passed');

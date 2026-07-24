import assert from 'node:assert/strict';

import { uniqueRowsByCode } from './market-review-data.js';

interface IQuoteRow {
  code: string;
  changePercent?: number | string;
}

const rows: IQuoteRow[] = [
  { code: '000001', changePercent: 1.2 },
  { code: '300001', changePercent: 3.4 },
  { code: '300001', changePercent: 3.4 },
  { code: '688001', changePercent: -2.1 },
  { code: '688001', changePercent: -2.1 },
];
const uniqueRows = uniqueRowsByCode(rows);
const changes = uniqueRows.map((row) => Number(row.changePercent)).filter(Number.isFinite);
const rising = changes.filter((value) => value > 0);
const falling = changes.filter((value) => value < 0);

assert.equal(uniqueRows.length, 3);
assert.equal(rising.length, 2);
assert.equal(falling.length, 1);
assert(rising.length + falling.length <= uniqueRows.length);

console.log('market-review selfcheck passed');

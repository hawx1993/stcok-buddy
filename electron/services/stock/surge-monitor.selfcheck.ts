import assert from 'node:assert/strict';
import { isChinaMarketOpen } from '../../../src/shared/market-time.js';

assert.equal(isChinaMarketOpen(new Date('2026-07-23T01:30:00.000Z')), true);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T03:30:00.000Z')), true);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T04:30:00.000Z')), false);
assert.equal(isChinaMarketOpen(new Date('2026-07-23T07:01:00.000Z')), false);
assert.equal(isChinaMarketOpen(new Date('2026-07-25T01:30:00.000Z')), false);

console.log('surge-monitor selfcheck passed');

import assert from 'node:assert/strict';
import type { HotFocusItem } from '../../../src/shared/types.js';
import { createHotStockHintGroups } from '../../../src/components/chat-view/components/hot-stock-hints.js';

const items: HotFocusItem[] = Array.from({ length: 25 }, (_, index) => ({
  id: `hint-${index}`,
  title: `股票${index}`,
  code: String(600000 + index),
  name: `股票${index}`,
  tag: '封涨停板',
}));

const groups = createHotStockHintGroups(items);
assert.equal(groups.length, 15);
for (const group of groups) {
  assert.equal(group.length, 5);
  assert.equal(new Set(group.map((hint) => hint.code)).size, 5);
}
assert.deepEqual(groups.slice(0, 5).map((group) => group.map((hint) => hint.code)), [
  ['600000', '600001', '600002', '600003', '600004'],
  ['600005', '600006', '600007', '600008', '600009'],
  ['600010', '600011', '600012', '600013', '600014'],
  ['600015', '600016', '600017', '600018', '600019'],
  ['600020', '600021', '600022', '600023', '600024'],
]);
assert.equal(new Set(groups.slice(5).map((group) => group.map((hint) => hint.code).join(','))).size, 10);

const limitedGroups = createHotStockHintGroups(items.slice(0, 3));
assert.equal(limitedGroups.length, 1);
assert.deepEqual(limitedGroups[0].map((hint) => hint.code), ['600000', '600001', '600002']);
for (const group of limitedGroups) assert.equal(new Set(group.map((hint) => hint.code)).size, group.length);

console.log('hot-stock-hints selfcheck passed');

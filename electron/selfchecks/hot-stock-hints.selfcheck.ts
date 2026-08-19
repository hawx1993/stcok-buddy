import assert from 'node:assert/strict';
import type { HotFocusItem } from '../../src/shared/types.js';
import { createHotStockHintGroups } from '../../src/components/chat-view/components/hot-stock-hints.js';
import { listHotStockHintSource } from '../../src/shared/hot-stock-hints-service.js';

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
assert.deepEqual(
  groups.slice(0, 5).map((group) => group.map((hint) => hint.code)),
  [
    ['600000', '600001', '600002', '600003', '600004'],
    ['600005', '600006', '600007', '600008', '600009'],
    ['600010', '600011', '600012', '600013', '600014'],
    ['600015', '600016', '600017', '600018', '600019'],
    ['600020', '600021', '600022', '600023', '600024'],
  ],
);
assert.equal(new Set(groups.slice(5).map((group) => group.map((hint) => hint.code).join(','))).size, 10);

const limitedGroups = createHotStockHintGroups(items.slice(0, 3));
assert.equal(limitedGroups.length, 1);
assert.deepEqual(
  limitedGroups[0].map((hint) => hint.code),
  ['600000', '600001', '600002'],
);
for (const group of limitedGroups) assert.equal(new Set(group.map((hint) => hint.code)).size, group.length);

const previousTradeItems = items.slice(0, 12);
const previousTradeSource = await listHotStockHintSource(new Date('2026-07-25T01:30:00.000Z'), {
  async isTradingDay() {
    return false;
  },
  async previousTradingDay() {
    return '2026-07-24';
  },
  async listCurrentHotFocus() {
    throw new Error('非交易日不应获取当日热点');
  },
  async listPreviousSurge(date) {
    assert.equal(date, '2026-07-24');
    return previousTradeItems;
  },
  async listLimitUpPool() {
    throw new Error('已有历史热点时不应获取涨停池');
  },
});
assert.equal(previousTradeSource.isPreviousTradeDay, true);
assert.equal(previousTradeSource.tradeDate, '2026-07-24');
assert.equal(previousTradeSource.items.length, 10);

const emptyPreviousTradeSource = await listHotStockHintSource(new Date('2026-07-25T01:30:00.000Z'), {
  async isTradingDay() {
    return false;
  },
  async previousTradingDay(date) {
    const dates: Record<string, string> = {
      '2026-07-25': '2026-07-24',
      '2026-07-24': '2026-07-23',
      '2026-07-23': '2026-07-22',
      '2026-07-22': '2026-07-21',
      '2026-07-21': '2026-07-20',
    };
    const previousDate = dates[date];
    if (!previousDate) throw new Error(`缺少 ${date} 的上一交易日`);
    return previousDate;
  },
  async listCurrentHotFocus() {
    throw new Error('非交易日不应获取当日热点');
  },
  async listPreviousSurge() {
    return [];
  },
  async listLimitUpPool() {
    return [];
  },
});
assert.equal(emptyPreviousTradeSource.items.length, 0);

const recoveredSource = await listHotStockHintSource(new Date('2026-07-25T01:30:00.000Z'), {
  async isTradingDay() {
    return false;
  },
  async previousTradingDay(date) {
    const dates: Record<string, string> = {
      '2026-07-25': '2026-07-24',
      '2026-07-24': '2026-07-23',
      '2026-07-23': '2026-07-22',
      '2026-07-22': '2026-07-21',
      '2026-07-21': '2026-07-20',
    };
    const previousDate = dates[date];
    if (!previousDate) throw new Error(`缺少 ${date} 的上一交易日`);
    return previousDate;
  },
  async listCurrentHotFocus() {
    throw new Error('非交易日不应获取当日热点');
  },
  async listPreviousSurge() {
    throw new Error('历史热点数据源不可用');
  },
  async listLimitUpPool(date) {
    if (date !== '2026-07-24') return [];
    return [{ code: '600519', name: '贵州茅台', totalMarketValue: 1_000_000_000_000 }];
  },
});
assert.equal(recoveredSource.items.length, 1);
assert.equal(recoveredSource.items[0]?.code, '600519');

const calendarRecoveredSource = await listHotStockHintSource(new Date('2026-07-24T01:30:00.000Z'), {
  async isTradingDay() {
    throw new Error('交易日历不可用');
  },
  async previousTradingDay() {
    throw new Error('上一交易日不可用');
  },
  async listCurrentHotFocus() {
    throw new Error('当日热点不可用');
  },
  async listPreviousSurge() {
    throw new Error('历史热点不可用');
  },
  async listLimitUpPool(date) {
    assert.equal(date, '2026-07-24');
    return [{ code: '600313', name: '农发种业', totalMarketValue: 8_000_000_000, continuousBoardCount: 3 }];
  },
});
assert.equal(calendarRecoveredSource.tradeDate, '2026-07-24');
assert.equal(calendarRecoveredSource.isPreviousTradeDay, false);
assert.equal(calendarRecoveredSource.items[0]?.code, '600313');

console.log('hot-stock-hints selfcheck passed');

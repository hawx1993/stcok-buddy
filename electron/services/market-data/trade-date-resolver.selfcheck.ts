import assert from 'node:assert/strict';
import { isBeforeShanghaiCutoff, resolveTradingDate, toShanghaiMarketTime, type ITradingCalendarClient } from './trade-date-resolver.js';

const calendar: ITradingCalendarClient = {
  isTradingDay: async (date) => date === '2026-07-23',
  previousTradingDay: async (date) => ({ '2026-07-23': '2026-07-22', '2026-07-25': '2026-07-23', '2026-10-08': '2026-09-30' })[date] ?? '2026-07-22',
};

assert.deepEqual(toShanghaiMarketTime(new Date('2026-07-23T01:29:00.000Z')), { date: '2026-07-23', minutes: 9 * 60 + 29 });
assert.equal(isBeforeShanghaiCutoff(9 * 60 + 30, new Date('2026-07-23T01:29:00.000Z')), true);
assert.equal(isBeforeShanghaiCutoff(9 * 60 + 30, new Date('2026-07-23T01:30:00.000Z')), false);
assert.equal(await resolveTradingDate(9 * 60 + 30, new Date('2026-07-23T01:29:00.000Z'), calendar), '2026-07-22');
assert.equal(await resolveTradingDate(9 * 60 + 30, new Date('2026-07-23T01:30:00.000Z'), calendar), '2026-07-23');
assert.equal(await resolveTradingDate(9 * 60 + 30, new Date('2026-07-25T01:30:00.000Z'), calendar), '2026-07-23');
assert.equal(await resolveTradingDate(9 * 60 + 30, new Date('2026-10-08T01:30:00.000Z'), calendar), '2026-09-30');
await assert.rejects(
  () => resolveTradingDate(9 * 60 + 30, new Date('2026-07-23T01:29:00.000Z'), {
    isTradingDay: async () => true,
    previousTradingDay: async () => { throw new Error('交易日历不可用'); },
  }),
  /交易日历不可用/,
);

console.log('trade-date-resolver selfcheck passed');

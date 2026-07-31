import { describe, expect, it, vi } from 'vitest';

import { isBeforeShanghaiCutoff, resolveTradingDate, toShanghaiMarketTime } from '../trade-date-resolver.js';
import type { ITradingCalendarClient } from '../trade-date-resolver.js';

function createCalendar(isTradingDay: boolean, previous = '2026-07-30'): ITradingCalendarClient {
  return {
    isTradingDay: vi.fn().mockResolvedValue(isTradingDay),
    previousTradingDay: vi.fn().mockResolvedValue(previous),
  };
}

describe('北京时间转换', () => {
  it('将 UTC 时间转换为上海日期和分钟数', () => {
    expect(toShanghaiMarketTime(new Date('2026-07-31T01:29:00.000Z'))).toEqual({
      date: '2026-07-31',
      minutes: 9 * 60 + 29,
    });
  });

  it('处理上海日期跨日', () => {
    expect(toShanghaiMarketTime(new Date('2026-07-30T16:01:00.000Z'))).toEqual({
      date: '2026-07-31',
      minutes: 1,
    });
  });
});

describe('上海 cutoff 判断', () => {
  it('截止时间前返回 true 且截止时刻返回 false', () => {
    expect(isBeforeShanghaiCutoff(9 * 60 + 30, new Date('2026-07-31T01:29:00.000Z'))).toBe(true);
    expect(isBeforeShanghaiCutoff(9 * 60 + 30, new Date('2026-07-31T01:30:00.000Z'))).toBe(false);
  });
});

describe('交易日解析', () => {
  it('交易日 cutoff 后返回当天上海日期', async () => {
    const calendar = createCalendar(true);

    await expect(resolveTradingDate(9 * 60 + 30, new Date('2026-07-31T01:30:00.000Z'), calendar)).resolves.toBe('2026-07-31');
    expect(calendar.isTradingDay).toHaveBeenCalledWith('2026-07-31');
    expect(calendar.previousTradingDay).not.toHaveBeenCalled();
  });

  it('截止时间前返回上一交易日', async () => {
    const calendar = createCalendar(true, '2026-07-29');

    await expect(resolveTradingDate(9 * 60 + 30, new Date('2026-07-31T01:29:00.000Z'), calendar)).resolves.toBe('2026-07-29');
    expect(calendar.previousTradingDay).toHaveBeenCalledWith('2026-07-31');
  });

  it('非交易日返回上一交易日', async () => {
    const calendar = createCalendar(false, '2026-07-30');

    await expect(resolveTradingDate(9 * 60 + 30, new Date('2026-08-01T02:00:00.000Z'), calendar)).resolves.toBe('2026-07-30');
    expect(calendar.previousTradingDay).toHaveBeenCalledWith('2026-08-01');
  });
});

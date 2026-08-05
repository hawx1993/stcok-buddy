import { describe, expect, it } from 'vitest';
import type { SecurityRecord, TradeCalendarRecord } from '../types.js';
import {
  classifyMarketBoard,
  historicalBackfillRange,
  isValidDateRange,
  recentStartDate,
  sortSecuritiesForSync,
} from '../market-data-sync-plan.js';

function security(symbol: string): SecurityRecord {
  return {
    symbol,
    name: symbol,
    exchange: symbol.startsWith('6') ? 'SH' : symbol.startsWith('8') ? 'BJ' : 'SZ',
    securityType: 'stock',
    status: 'listed',
    isSt: false,
    source: 'vitest',
    updatedAt: '2026-08-04T10:00:00.000Z',
  };
}

function calendar(dates: string[]): TradeCalendarRecord[] {
  return dates.map((tradeDate, index) => ({
    market: 'A',
    tradeDate,
    isOpen: true,
    previousTradeDate: dates[index - 1],
    nextTradeDate: dates[index + 1],
    source: 'vitest',
    updatedAt: '2026-08-04T10:00:00.000Z',
  }));
}

describe('market data sync planning helpers', () => {
  it('classifies and sorts securities by board priority', () => {
    expect(classifyMarketBoard('600519')).toBe('sh-main');
    expect(classifyMarketBoard('000001')).toBe('sz-main');
    expect(classifyMarketBoard('300001')).toBe('gem');
    expect(classifyMarketBoard('688001')).toBe('star');
    expect(classifyMarketBoard('835185')).toBe('bj');

    expect(sortSecuritiesForSync([
      security('835185'),
      security('688001'),
      security('300001'),
      security('000001'),
      security('600519'),
      security('600000'),
    ]).map((item) => item.symbol)).toEqual(['600000', '600519', '000001', '300001', '688001', '835185']);
  });

  it('uses the trading calendar to choose a recent-first start date', () => {
    const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07'];

    expect(recentStartDate(calendar(dates), '2026-07-07', 3)).toBe('2026-07-03');
  });

  it('builds a historical backfill range before the recent window', () => {
    expect(historicalBackfillRange('2026-08-04', '2025-02-18')).toEqual({
      startDate: '2016-08-04',
      endDate: '2025-02-17',
    });
    expect(isValidDateRange('2026-08-04', '2026-08-03')).toBe(false);
  });
});

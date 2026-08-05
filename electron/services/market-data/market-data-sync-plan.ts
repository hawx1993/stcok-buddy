import type { SecurityRecord, TradeCalendarRecord } from './types.js';

export const INITIAL_YEARS = 10;
export const RECENT_TRADING_DAYS = 360;

export type TMarketBoard = 'sh-main' | 'sz-main' | 'gem' | 'star' | 'bj';

const BOARD_PRIORITY: Record<TMarketBoard, number> = {
  'sh-main': 0,
  'sz-main': 1,
  gem: 2,
  star: 3,
  bj: 4,
};

export function classifyMarketBoard(symbol: string): TMarketBoard {
  if (symbol.startsWith('688')) return 'star';
  if (symbol.startsWith('300') || symbol.startsWith('301')) return 'gem';
  if (symbol.startsWith('4') || symbol.startsWith('8') || symbol.startsWith('92')) return 'bj';
  if (symbol.startsWith('6')) return 'sh-main';
  return 'sz-main';
}

export function sortSecuritiesForSync(securities: SecurityRecord[]): SecurityRecord[] {
  return [...securities].sort((left, right) => {
    const boardDiff = BOARD_PRIORITY[classifyMarketBoard(left.symbol)] - BOARD_PRIORITY[classifyMarketBoard(right.symbol)];
    if (boardDiff !== 0) return boardDiff;
    return left.symbol.localeCompare(right.symbol);
  });
}

export function recentStartDate(
  calendar: TradeCalendarRecord[],
  targetTradeDate: string,
  recentTradingDays = RECENT_TRADING_DAYS,
): string {
  const dates = calendar
    .filter((item) => item.market === 'A' && item.isOpen && item.tradeDate <= targetTradeDate)
    .map((item) => item.tradeDate)
    .sort();
  const targetIndex = dates.lastIndexOf(targetTradeDate);
  const endIndex = targetIndex >= 0 ? targetIndex : dates.length - 1;
  if (endIndex >= 0) return dates[Math.max(0, endIndex - recentTradingDays + 1)];
  return yearsAgo(targetTradeDate, 2);
}

export function historicalBackfillRange(targetTradeDate: string, recentStart: string) {
  const startDate = yearsAgo(targetTradeDate, INITIAL_YEARS);
  const endDate = dayBefore(recentStart);
  return isValidDateRange(startDate, endDate) ? { startDate, endDate } : undefined;
}

export function isValidDateRange(startDate: string, endDate: string): boolean {
  return startDate <= endDate;
}

export function yearsAgo(target: string, years: number) {
  const date = new Date(`${target}T12:00:00+08:00`);
  date.setFullYear(date.getFullYear() - years);
  return isoDate(date);
}

export function dayAfter(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() + 1);
  return isoDate(date);
}

export function dayBefore(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() - 1);
  return isoDate(date);
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

import { isRemoteTradingDay, previousRemoteTradingDay } from './providers.js';

export interface ITradingCalendarClient {
  isTradingDay(date: string): Promise<boolean>;
  previousTradingDay(date: string): Promise<string>;
}

const defaultCalendarClient: ITradingCalendarClient = {
  isTradingDay: isRemoteTradingDay,
  previousTradingDay: previousRemoteTradingDay,
};

const TRADING_CALENDAR_REQUEST_TIMEOUT_MS = 20_000;

export async function resolveTradingDate(
  cutoffMinutes: number,
  now = new Date(),
  calendar: ITradingCalendarClient = defaultCalendarClient,
): Promise<string> {
  const marketTime = toShanghaiMarketTime(now);
  const isTradingDay = await withTradingCalendarTimeout(calendar.isTradingDay(marketTime.date));
  if (isTradingDay && marketTime.minutes >= cutoffMinutes) return marketTime.date;
  return withTradingCalendarTimeout(calendar.previousTradingDay(marketTime.date));
}

async function withTradingCalendarTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('交易日历请求超时，请稍后重试')), TRADING_CALENDAR_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isBeforeShanghaiCutoff(cutoffMinutes: number, now = new Date()): boolean {
  return toShanghaiMarketTime(now).minutes < cutoffMinutes;
}

export function toShanghaiMarketTime(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error('无法解析北京时间');
  }
  return { date: `${year}-${month}-${day}`, minutes: hour * 60 + minute };
}

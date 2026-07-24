import { isRemoteTradingDay, previousRemoteTradingDay } from './providers.js';

export interface ITradingCalendarClient {
  isTradingDay(date: string): Promise<boolean>;
  previousTradingDay(date: string): Promise<string>;
}

const defaultCalendarClient: ITradingCalendarClient = {
  isTradingDay: isRemoteTradingDay,
  previousTradingDay: previousRemoteTradingDay,
};

export async function resolveTradingDate(
  cutoffMinutes: number,
  now = new Date(),
  calendar: ITradingCalendarClient = defaultCalendarClient,
): Promise<string> {
  const marketTime = toShanghaiMarketTime(now);
  const isTradingDay = await calendar.isTradingDay(marketTime.date);
  if (isTradingDay && marketTime.minutes >= cutoffMinutes) return marketTime.date;
  return calendar.previousTradingDay(marketTime.date);
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

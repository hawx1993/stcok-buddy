export const A_SHARE_MARKET_OPEN_MINUTE = 9 * 60 + 30;
export const A_SHARE_MORNING_CLOSE_MINUTE = 11 * 60 + 30;
export const A_SHARE_AFTERNOON_OPEN_MINUTE = 13 * 60;
export const A_SHARE_MARKET_CLOSE_MINUTE = 15 * 60;
export const A_SHARE_TOTAL_TRADING_MINUTES =
  A_SHARE_MORNING_CLOSE_MINUTE - A_SHARE_MARKET_OPEN_MINUTE + A_SHARE_MARKET_CLOSE_MINUTE - A_SHARE_AFTERNOON_OPEN_MINUTE;

export interface IAshareMarketPhase {
  label: string;
  isTrading: boolean;
}

export interface IShanghaiMarketTime {
  date: string;
  minutes: number;
  weekday: number;
}

export function toShanghaiMarketTime(now: Date): IShanghaiMarketTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const weekday = weekdayIndex(value('weekday'));
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute) || weekday === undefined) {
    throw new Error('无法解析北京时间');
  }
  return { date: `${year}-${month}-${day}`, minutes: hour * 60 + minute, weekday };
}

export function getAshareMarketPhase(now = new Date()): IAshareMarketPhase {
  const { minutes, weekday } = toShanghaiMarketTime(now);
  if (weekday === 0 || weekday === 6) return { label: '非交易日', isTrading: false };
  if (minutes < 9 * 60 + 25) return { label: '盘前', isTrading: false };
  if (minutes < A_SHARE_MARKET_OPEN_MINUTE) return { label: '集合竞价', isTrading: true };
  if (minutes <= A_SHARE_MORNING_CLOSE_MINUTE) return { label: '盘中', isTrading: true };
  if (minutes < A_SHARE_AFTERNOON_OPEN_MINUTE) return { label: '午间休市', isTrading: false };
  if (minutes <= A_SHARE_MARKET_CLOSE_MINUTE) return { label: '盘中', isTrading: true };
  return { label: '已收盘', isTrading: false };
}

export function isChinaMarketOpen(now = new Date()): boolean {
  return getAshareMarketPhase(now).isTrading;
}

export function getAShareTradingMinuteOffset(time: string): number | undefined {
  const minute = parseTimelineMinute(time);
  if (minute === undefined) return undefined;
  if (minute >= A_SHARE_MARKET_OPEN_MINUTE && minute <= A_SHARE_MORNING_CLOSE_MINUTE) return minute - A_SHARE_MARKET_OPEN_MINUTE;
  if (minute >= A_SHARE_AFTERNOON_OPEN_MINUTE && minute <= A_SHARE_MARKET_CLOSE_MINUTE) {
    return A_SHARE_MORNING_CLOSE_MINUTE - A_SHARE_MARKET_OPEN_MINUTE + minute - A_SHARE_AFTERNOON_OPEN_MINUTE;
  }
  return undefined;
}

function parseTimelineMinute(time: string): number | undefined {
  const match = /(?:^|\D)(\d{1,2}):(\d{2})(?::\d{2})?/.exec(time.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function weekdayIndex(value: string | undefined): number | undefined {
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[value ?? ''];
}

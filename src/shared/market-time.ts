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

export function isChinaMarketOpen(now = new Date()): boolean {
  const { minutes, weekday } = toShanghaiMarketTime(now);
  if (weekday === 0 || weekday === 6) return false;
  return (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function weekdayIndex(value: string | undefined): number | undefined {
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[value ?? ''];
}

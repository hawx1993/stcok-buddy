import type { HotFocusItem, IHotStockHintSource } from './types.js';

export interface IHotStockHintLoaders {
  isTradingDay(date: string): Promise<boolean>;
  previousTradingDay(date: string): Promise<string>;
  listCurrentHotFocus(): Promise<HotFocusItem[]>;
  listPreviousSurge(date: string): Promise<HotFocusItem[]>;
}

export function toShanghaiDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) throw new Error('无法解析北京时间');
  return `${year}-${month}-${day}`;
}

export async function listHotStockHintSource(
  now: Date,
  loaders: IHotStockHintLoaders,
): Promise<IHotStockHintSource> {
  const tradeDate = toShanghaiDate(now);
  if (await loaders.isTradingDay(tradeDate)) {
    const items = await loaders.listCurrentHotFocus();
    return { items: items.slice(0, 10), tradeDate, isPreviousTradeDay: false };
  }

  const previousTradeDate = await loaders.previousTradingDay(tradeDate);
  const items = await loaders.listPreviousSurge(previousTradeDate);
  return { items: items.slice(0, 10), tradeDate: previousTradeDate, isPreviousTradeDay: true };
}

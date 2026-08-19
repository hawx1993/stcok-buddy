import type { HotFocusItem, IHotStockHintSource } from './types.js';

const HOT_STOCK_HINT_LIMIT = 10;
const HISTORICAL_FALLBACK_DAYS = 2;
const RECENT_LIMIT_UP_TRADING_DAYS = 5;
const LIMIT_UP_HINT_LIMIT = 5;
const A_SHARE_CODE_PATTERN = /^\d{6}$/;
const TRADE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface IHotStockLimitUpItem {
  code: string;
  name: string;
  totalMarketValue: number | null;
  continuousBoardCount?: number | null;
  ztStatistics?: string | null;
}

export interface IHotStockHintLoaders {
  isTradingDay(date: string): Promise<boolean>;
  previousTradingDay(date: string): Promise<string>;
  listCurrentHotFocus(): Promise<HotFocusItem[]>;
  listPreviousSurge(date: string): Promise<HotFocusItem[]>;
  listLimitUpPool(date: string): Promise<IHotStockLimitUpItem[]>;
}

type TLoaderResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; error: Error };

interface IRecentLimitUpResult {
  items: HotFocusItem[];
  sourceDate?: string;
  errors: Error[];
  hasRespondingSource: boolean;
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

export function normalizeHotStockHintItems(
  items: HotFocusItem[],
  limit = HOT_STOCK_HINT_LIMIT,
): HotFocusItem[] {
  const normalized: HotFocusItem[] = [];
  const seenCodes = new Set<string>();
  for (const item of items) {
    const code = item.code?.trim();
    const name = item.name?.trim();
    if (!code || !name || !A_SHARE_CODE_PATTERN.test(code) || seenCodes.has(code)) continue;
    seenCodes.add(code);
    normalized.push({ ...item, code, name });
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export async function listHotStockHintSource(
  now: Date,
  loaders: IHotStockHintLoaders,
): Promise<IHotStockHintSource> {
  const tradeDate = toShanghaiDate(now);
  const sourceErrors: Error[] = [];
  const tradingDayResult = await settleLoader(loaders.isTradingDay(tradeDate));
  const isTradingDay = tradingDayResult.status === 'fulfilled' && tradingDayResult.value;
  const isTradingDayUnknown = tradingDayResult.status === 'rejected';
  if (tradingDayResult.status === 'rejected') sourceErrors.push(tradingDayResult.error);

  let hasRespondingStockSource = false;
  if (isTradingDay || isTradingDayUnknown) {
    const currentResult = await settleLoader(loaders.listCurrentHotFocus());
    if (currentResult.status === 'fulfilled') {
      hasRespondingStockSource = true;
      const currentItems = normalizeHotStockHintItems(currentResult.value);
      if (currentItems.length) {
        return { items: currentItems, tradeDate, isPreviousTradeDay: false };
      }
    } else {
      sourceErrors.push(currentResult.error);
    }
  }

  const recentTradeDates = isTradingDay || isTradingDayUnknown ? [tradeDate] : [];
  let dateCursor = tradeDate;
  let lastHistoricalDate: string | undefined;
  let canResolvePreviousTradeDates = true;
  for (let index = 0; index < HISTORICAL_FALLBACK_DAYS; index += 1) {
    const previousDateResult = await settleLoader(
      resolvePreviousTradingDate(dateCursor, recentTradeDates, loaders.previousTradingDay),
    );
    if (previousDateResult.status === 'rejected') {
      sourceErrors.push(previousDateResult.error);
      canResolvePreviousTradeDates = false;
      break;
    }

    dateCursor = previousDateResult.value;
    recentTradeDates.push(dateCursor);
    lastHistoricalDate = dateCursor;

    const historicalResult = await settleLoader(loaders.listPreviousSurge(dateCursor));
    if (historicalResult.status === 'rejected') {
      sourceErrors.push(historicalResult.error);
      continue;
    }

    hasRespondingStockSource = true;
    const historicalItems = normalizeHotStockHintItems(historicalResult.value);
    if (historicalItems.length) {
      return { items: historicalItems, tradeDate: dateCursor, isPreviousTradeDay: true };
    }
  }

  while (canResolvePreviousTradeDates && recentTradeDates.length < RECENT_LIMIT_UP_TRADING_DAYS) {
    const previousDateResult = await settleLoader(
      resolvePreviousTradingDate(dateCursor, recentTradeDates, loaders.previousTradingDay),
    );
    if (previousDateResult.status === 'rejected') {
      sourceErrors.push(previousDateResult.error);
      canResolvePreviousTradeDates = false;
      break;
    }

    dateCursor = previousDateResult.value;
    recentTradeDates.push(dateCursor);
  }

  const limitUpResult = await listRecentLimitUps(recentTradeDates, loaders.listLimitUpPool);
  sourceErrors.push(...limitUpResult.errors);
  hasRespondingStockSource ||= limitUpResult.hasRespondingSource;
  if (limitUpResult.items.length) {
    const usesCurrentLimitUpFallback = limitUpResult.sourceDate === tradeDate
      && (isTradingDayUnknown || !canResolvePreviousTradeDates);
    if (usesCurrentLimitUpFallback) {
      return { items: limitUpResult.items, tradeDate, isPreviousTradeDay: false };
    }
    return { items: limitUpResult.items, isPreviousTradeDay: true };
  }
  if (!hasRespondingStockSource && sourceErrors.length) {
    throw new Error(`热点数据源暂不可用：${sourceErrors.map((error) => error.message).join('；')}`);
  }
  return { items: [], tradeDate: lastHistoricalDate, isPreviousTradeDay: true };
}

async function resolvePreviousTradingDate(
  date: string,
  knownDates: string[],
  previousTradingDay: IHotStockHintLoaders['previousTradingDay'],
) {
  const previousDate = await previousTradingDay(date);
  if (
    !TRADE_DATE_PATTERN.test(previousDate) ||
    previousDate === date ||
    knownDates.includes(previousDate)
  ) {
    throw new Error(`无法解析 ${date} 的上一交易日`);
  }
  return previousDate;
}

async function listRecentLimitUps(
  tradeDates: string[],
  listLimitUpPool: IHotStockHintLoaders['listLimitUpPool'],
): Promise<IRecentLimitUpResult> {
  const hints: HotFocusItem[] = [];
  const errors: Error[] = [];
  const seenCodes = new Set<string>();
  let sourceDate: string | undefined;
  let hasRespondingSource = false;

  for (const date of tradeDates) {
    const result = await settleLoader(listLimitUpPool(date));
    if (result.status === 'rejected') {
      errors.push(result.error);
      continue;
    }

    hasRespondingSource = true;
    for (const item of [...result.value].sort(compareLimitUpItems)) {
      const hint = toLimitUpHint(item, date);
      const code = hint?.code;
      if (!hint || !code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      hints.push(hint);
      sourceDate ??= date;
      if (hints.length >= LIMIT_UP_HINT_LIMIT) {
        return { items: hints, sourceDate, errors, hasRespondingSource };
      }
    }
  }

  return { items: hints, sourceDate, errors, hasRespondingSource };
}

async function settleLoader<T>(request: Promise<T>): Promise<TLoaderResult<T>> {
  const [result] = await Promise.allSettled([request]);
  if (result.status === 'fulfilled') return result;
  return { status: 'rejected', error: toSourceError(result.reason) };
}

function toSourceError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('热点数据源请求失败');
}

function compareLimitUpItems(left: IHotStockLimitUpItem, right: IHotStockLimitUpItem) {
  const boardCountDifference = (right.continuousBoardCount ?? 0) - (left.continuousBoardCount ?? 0);
  if (boardCountDifference) return boardCountDifference;
  return (right.totalMarketValue ?? 0) - (left.totalMarketValue ?? 0);
}

function toLimitUpHint(item: IHotStockLimitUpItem, date: string): HotFocusItem | undefined {
  const code = item.code.trim();
  const name = item.name.trim();
  if (!A_SHARE_CODE_PATTERN.test(code) || !name) return undefined;
  const boardCount = item.continuousBoardCount && item.continuousBoardCount >= 2
    ? Math.trunc(item.continuousBoardCount)
    : undefined;
  const statistics = item.ztStatistics?.trim();
  const description = [
    `涨停日期 ${date}`,
    boardCount ? `${boardCount}连板` : '涨停',
    statistics ? `涨停统计 ${statistics}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  return {
    id: `recent-limit-up-${date}-${code}`,
    title: `${name} ${code}`,
    code,
    name,
    description,
    tag: '封涨停板',
    type: 'surge',
  };
}

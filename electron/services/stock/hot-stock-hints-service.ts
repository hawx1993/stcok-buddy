import type { HotFocusItem, IHotStockHintSource } from '../../../src/shared/types.js';
import {
  listHotStockHintSource as sharedListHotStockHintSource,
  normalizeHotStockHintItems,
  toShanghaiDate,
  type IHotStockHintLoaders,
} from '../../../src/shared/hot-stock-hints-service.js';
import { getLatestHotStockHintSnapshot, saveHotStockHintSnapshot } from '../stock-db/quote-store.js';
import { isRemoteTradingDay, previousRemoteTradingDay } from '../market-data/providers.js';
import { listHotFocus } from './stock-client.js';
import { sdk } from './shared.js';
import { listSurgeHistoryWithBackfill } from './surge-history-service.js';

const defaultLoaders: IHotStockHintLoaders = {
  isTradingDay: isRemoteTradingDay,
  previousTradingDay: previousRemoteTradingDay,
  listCurrentHotFocus: async () => {
    const results = await Promise.allSettled([listHotFocus('surge'), listHotFocus('sector')]);
    const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (items.length || results.some((result) => result.status === 'fulfilled')) return items;

    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      throw toCurrentHotFocusError(rejected.reason);
    }
    throw new Error('当日热点数据源不可用');
  },

  listPreviousSurge: (date) => listSurgeHistoryWithBackfill(date, 0, 10),
  listLimitUpPool: (date) => sdk.marketEvent.ztPool('zt', date),
};

let pendingRefresh: Promise<IHotStockHintSource> | undefined;

export interface IHotStockHintSourceResult {
  source: IHotStockHintSource;
  refresh?: Promise<IHotStockHintSource>;
}

export type { HotFocusItem, IHotStockHintLoaders, IHotStockHintSource };

export async function getHotStockHintSource(now = new Date()): Promise<IHotStockHintSourceResult> {
  const cacheDate = toShanghaiDate(now);
  const cached = getLatestHotStockHintSnapshot();
  if (cached) {
    const source = sourceForDisplay(cached.source, cacheDate);
    return {
      source,
      refresh: cached.cacheDate === cacheDate && source.items.length
        ? undefined
        : refreshHotStockHintSource(now),
    };
  }

  return { source: await refreshHotStockHintSource(now) };
}

export async function listHotStockHintSource(now = new Date()): Promise<IHotStockHintSource> {
  const result = await getHotStockHintSource(now);
  return result.source;
}

function refreshHotStockHintSource(now: Date): Promise<IHotStockHintSource> {
  if (!pendingRefresh) {
    const cacheDate = toShanghaiDate(now);
    pendingRefresh = sharedListHotStockHintSource(now, defaultLoaders)
      .then((source) => {
        saveHotStockHintSnapshot(cacheDate, source);
        return sourceForDisplay(source, cacheDate);
      })
      .finally(() => {
        pendingRefresh = undefined;
      });
  }
  return pendingRefresh;
}

function sourceForDisplay(source: IHotStockHintSource, cacheDate: string): IHotStockHintSource {
  return {
    ...source,
    items: normalizeHotStockHintItems(source.items),
    isPreviousTradeDay: source.isPreviousTradeDay || Boolean(source.tradeDate && source.tradeDate !== cacheDate),
  };
}

function toCurrentHotFocusError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('当日热点数据源不可用');
}

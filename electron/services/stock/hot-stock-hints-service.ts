import type { HotFocusItem, IHotStockHintSource } from '../../../src/shared/types.js';
import {
  listHotStockHintSource as sharedListHotStockHintSource,
  toShanghaiDate,
  type IHotStockHintLoaders,
} from '../../../src/shared/hot-stock-hints-service.js';
import {
  getLatestHotStockHintSnapshot,
  saveHotStockHintSnapshot,
} from '../stock-db/quote-store.js';
import { isRemoteTradingDay, previousRemoteTradingDay } from '../market-data/providers.js';
import { listHotFocus } from './stock-client.js';
import { listSurgeHistoryWithBackfill } from './surge-history-service.js';

const defaultLoaders: IHotStockHintLoaders = {
  isTradingDay: isRemoteTradingDay,
  previousTradingDay: previousRemoteTradingDay,
  listCurrentHotFocus: async () => {
    const [surge, sector] = await Promise.all([listHotFocus('surge'), listHotFocus('sector')]);
    return [...surge, ...sector];
  },
  listPreviousSurge: (date) => listSurgeHistoryWithBackfill(date, 0, 10),
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
    return {
      source: sourceForDisplay(cached.source, cacheDate),
      refresh: cached.cacheDate === cacheDate ? undefined : refreshHotStockHintSource(now),
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
    isPreviousTradeDay: source.isPreviousTradeDay || Boolean(source.tradeDate && source.tradeDate !== cacheDate),
  };
}

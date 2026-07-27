import type { HotFocusItem, IHotStockHintSource } from '../../../src/shared/types.js';
import {
  listHotStockHintSource as sharedListHotStockHintSource,
  type IHotStockHintLoaders,
} from '../../../src/shared/hot-stock-hints-service.js';
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

export { IHotStockHintLoaders, IHotStockHintSource, HotFocusItem };

export async function listHotStockHintSource(now = new Date()): Promise<IHotStockHintSource> {
  return sharedListHotStockHintSource(now, defaultLoaders);
}

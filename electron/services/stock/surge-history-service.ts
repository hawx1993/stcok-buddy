import type { HotFocusItem } from '../../../src/shared/types.js';
import { listEastmoneySurgeByDate } from './stock-client.js';
import { clearSurgeHistoryDate, listSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

export async function listSurgeHistoryWithBackfill(date: string): Promise<HotFocusItem[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const items = await listEastmoneySurgeByDate(date);
  if (!items.length) return listSurgeHistory(date);
  await clearSurgeHistoryDate(date).catch(console.warn);
  await saveSurgeSnapshot(items, new Date(), date).catch(console.warn);
  return items;
}

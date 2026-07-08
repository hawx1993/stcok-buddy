import type { HotFocusItem } from '../../../src/shared/types.js';
import { listEastmoneySurgeByDate } from './stock-client.js';
import { clearSurgeHistoryDate, listSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

export async function listSurgeHistoryWithBackfill(date: string): Promise<HotFocusItem[]> {
  const saved = await listSurgeHistory(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  if (saved.length && !saved.some((item) => /涨停池|炸板池|跌停池/.test(item.tag ?? '') || /^\+/.test(item.amount ?? ''))) return saved;

  await clearSurgeHistoryDate(date);
  const items = await listEastmoneySurgeByDate(date);
  if (!items.length) return [];
  await saveSurgeSnapshot(items, new Date(), date);
  return listSurgeHistory(date);
}

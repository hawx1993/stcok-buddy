import type { HotFocusItem } from '../../../src/shared/types.js';
import { listSurgeHistory } from './surge-history-store.js';

export async function listSurgeHistoryWithBackfill(date: string): Promise<HotFocusItem[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return listSurgeHistory(date);
}

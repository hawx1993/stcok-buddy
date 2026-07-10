import type { HotFocusItem } from '../../../src/shared/types.js';
import { listEastmoneySurgeByDate } from './stock-client.js';
import { listSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

export async function listSurgeHistoryWithBackfill(date: string, offset = 0, limit = 20): Promise<HotFocusItem[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const local = await listSurgeHistory(date, offset, limit);
  if (local.length || offset > 0) return local;

  const remote = await listEastmoneySurgeByDate(date).catch(() => []);
  if (remote.length) void saveSurgeSnapshot(remote, new Date(`${date}T15:00:00+08:00`), date).catch(console.error);
  return remote.slice(0, limit);
}

import type { HotFocusItem } from '../../../src/shared/types.js';
import { listEastmoneySurgeByDate } from './stock-client.js';
import { isSurgeHistoryClearMarkerActive, listSurgeHistory, saveSurgeSnapshot } from './surge-history-store.js';

export async function listSurgeHistoryWithBackfill(date: string, offset = 0, limit = 20): Promise<HotFocusItem[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  // ponytail: while the clear marker is active, skip both local query and
  // remote backfill so historical dates stay empty and the DB file is not
  // recreated just to serve an empty result.
  if (isSurgeHistoryClearMarkerActive()) return [];
  const local = await listSurgeHistory(date, offset, limit);
  if (local.length || offset > 0) return local;

  const remote = await listEastmoneySurgeByDate(date);
  if (remote.length) void saveSurgeSnapshot(remote, new Date(`${date}T15:00:00+08:00`), date).catch(console.error);
  return remote.slice(0, limit);
}

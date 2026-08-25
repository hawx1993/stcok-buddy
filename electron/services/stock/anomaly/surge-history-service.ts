import { isRemoteTradingDay } from '../../market-data/providers.js';
import type { HotFocusItem } from '../../../../src/shared/types.js';
import { listEastmoneySurgeByDate } from '../stock-detail/stock-client.js';
import { withTimeoutReject } from '../quotes/shared.js';
import { shouldKeepSurgeItem } from './surge-large-order.js';
import { isSurgeHistoryClearMarkerActive, listSurgeHistory, saveSurgeSnapshot } from '../../stock-db/surge-history-store.js';

const TRADING_DAY_CHECK_TIMEOUT_MS = 2_000;

interface IListSurgeHistoryOptions {
  deferBackfill?: boolean;
}

const surgeBackfillInFlight = new Map<string, Promise<HotFocusItem[]>>();

export async function listSurgeHistoryWithBackfill(
  date: string,
  offset = 0,
  limit = 20,
  options: IListSurgeHistoryOptions = {},
): Promise<HotFocusItem[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  // ponytail: while the clear marker is active, skip both local query and
  // remote backfill so historical dates stay empty and the DB file is not
  // recreated just to serve an empty result.
  if (isSurgeHistoryClearMarkerActive()) return [];

  // Local-first: cached rows should not wait for a remote trading-calendar
  // request before the panel can leave its skeleton state.
  const local = (await listSurgeHistory(date, offset, limit)).filter(shouldKeepSurgeItem);
  if (local.length || offset > 0) return local;

  const backfill = startSurgeHistoryBackfill(date);
  if (options.deferBackfill) {
    // The right panel should render the local empty state immediately. The
    // scheduler/poll cycle will pick up rows after this real-data backfill is
    // persisted, while other callers keep the synchronous cold-cache path.
    void backfill.catch((error: unknown) => {
      console.warn('[surge-history] deferred backfill failed', date, error);
    });
    return [];
  }
  return (await backfill).slice(0, limit);
}

function startSurgeHistoryBackfill(date: string) {
  const existing = surgeBackfillInFlight.get(date);
  if (existing) return existing;
  const task = backfillSurgeHistory(date).finally(() => {
    if (surgeBackfillInFlight.get(date) === task) surgeBackfillInFlight.delete(date);
  });
  surgeBackfillInFlight.set(date, task);
  return task;
}

async function backfillSurgeHistory(date: string): Promise<HotFocusItem[]> {
  if (isSurgeHistoryClearMarkerActive()) return [];

  // A slow calendar provider must not keep a deferred panel in loading; the
  // caller may choose to use the synchronous default path instead.
  const isTradingDay = await withTimeoutReject(
    isRemoteTradingDay(date),
    TRADING_DAY_CHECK_TIMEOUT_MS,
    'trading day check timeout',
  ).catch(() => true);
  if (!isTradingDay || isSurgeHistoryClearMarkerActive()) return [];

  const remote = (await listEastmoneySurgeByDate(date)).filter(shouldKeepSurgeItem);
  if (remote.length && !isSurgeHistoryClearMarkerActive()) {
    void saveSurgeSnapshot(remote, new Date(`${date}T15:00:00+08:00`), date).catch((error: unknown) => {
      console.warn('[surge-history] backfill save failed', date, error);
    });
  }
  return remote;
}

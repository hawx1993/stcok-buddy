import { BrowserWindow } from '../../electron-runtime.js';
import { ensureMarketDataRuntime } from './market-data-scheduler.js';
import { startMarketDataSync } from './market-data-sync.js';
import { listSecurities } from './market-data-store.js';
import { ensureSurgeHistoryCapture, isSurgeHistorySchedulerRunning } from '../stock/surge-history-scheduler.js';
import {
  clearSurgeHistoryClearMarker,
  getSurgeHistoryFreshness,
  type ISurgeHistoryFreshness,
} from '../stock/surge-history-store.js';
import StockSDK from 'stock-sdk';

const sdk = new StockSDK({
  timeout: 15_000,
  retry: { maxRetries: 2, baseDelay: 500 },
});

const INDIVIDUAL_CONCURRENCY = 2;
const INDIVIDUAL_HISTORY_BATCH_SIZE = 500;
const SURGE_HISTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;
let surgeHistorySyncInFlight: Promise<void> | undefined;

interface ITaskProgress {
  taskType: string;
  status: 'running' | 'completed' | 'error';
  processed: number;
  total: number;
  message: string;
  error?: string;
}

function emitProgress(progress: ITaskProgress) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('dataSync:taskProgress', progress);
    }
  }
}

export function syncSurgeHistory() {
  if (surgeHistorySyncInFlight) return surgeHistorySyncInFlight;
  const task = runSurgeHistorySync().finally(() => {
    if (surgeHistorySyncInFlight === task) surgeHistorySyncInFlight = undefined;
  });
  surgeHistorySyncInFlight = task;
  return task;
}

export async function syncSurgeHistoryIfNeeded(now = new Date()) {
  ensureSurgeHistoryCapture();
  const freshness = await getSurgeHistoryFreshness();
  if (!shouldSyncSurgeHistory(freshness, now)) return false;
  await syncSurgeHistory();
  return true;
}

export function shouldSyncSurgeHistory(freshness: ISurgeHistoryFreshness, now = new Date()) {
  if (freshness.recordCount <= 0 || !freshness.latestCapturedAt) return true;
  const latestCapturedAt = new Date(freshness.latestCapturedAt);
  if (Number.isNaN(latestCapturedAt.getTime())) return true;
  return now.getTime() - latestCapturedAt.getTime() > SURGE_HISTORY_STALE_MS;
}

async function runSurgeHistorySync() {
  // ponytail: clearing the marker is required before a resync. The storage
  // manager sets this marker when the user clears surge history so that reads
  // return empty and writes are dropped for 30 minutes; without clearing it,
  // this sync would fetch an empty list and silently write nothing, looking
  // like it completed successfully but leaving the DB empty.
  clearSurgeHistoryClearMarker();

  const totalPhases = 2; // phase 1: today's snapshot, phase 2: individual history
  emitProgress({
    taskType: 'surge',
    status: 'running',
    processed: 0,
    total: totalPhases,
    message: '正在采集异动数据…',
  });

  try {
    // Dynamic import to avoid circular deps
    const { listHotFocus, toIndividualHistoryEvents } = await import('../stock/hot-focus.js');
    const { pruneSurgeHistory, saveSurgeSnapshot, saveIndividualSurgeHistory } = await import('../stock/surge-history-store.js');

    await ensureMarketDataRuntime();

    // Phase 1: sync today's general surge snapshot (existing behavior)
    const now = new Date();
    const items = await listHotFocus('surge');

    if (items.length > 0) {
      await saveSurgeSnapshot(items, now);
    }

    // Phase 2: sync individual stock surge history for every listed stock.
    let securities = await listSecurities();
    if (!securities.length) {
      await startMarketDataSync(false);
      securities = await listSecurities();
    }
    if (!securities.length) {
      throw new Error('本地证券列表为空，无法同步个股异动历史');
    }

    const codes = securities.map((security) => security.symbol);
    const individualSdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });
    const pendingEvents: Awaited<ReturnType<typeof toIndividualHistoryEvents>> = [];
    let individualTotal = 0;
    let done = 0;
    let failed = 0;

    const flushIndividualHistory = async (flushAll = false) => {
      while (pendingEvents.length >= INDIVIDUAL_HISTORY_BATCH_SIZE || (flushAll && pendingEvents.length > 0)) {
        const batch = pendingEvents.splice(0, flushAll ? pendingEvents.length : INDIVIDUAL_HISTORY_BATCH_SIZE);
        await saveIndividualSurgeHistory(batch);
        individualTotal += batch.length;
      }
    };

    await runPool(codes, INDIVIDUAL_CONCURRENCY, async (code) => {
      try {
        let events: Awaited<ReturnType<typeof toIndividualHistoryEvents>>;
        try {
          const history = await individualSdk.marketEvent.individualChangesHistory(code, { days: 7 });
          events = toIndividualHistoryEvents(history, code);
        } catch (error) {
          failed += 1;
          console.warn(`[data-sync] individual surge history failed for ${code}`, error instanceof Error ? error.message : String(error));
          return;
        }
        pendingEvents.push(...events);
        await flushIndividualHistory();
      } finally {
        done += 1;
        emitProgress({
          taskType: 'surge',
          status: 'running',
          processed: 1 + done / codes.length,
          total: totalPhases,
          message: `正在同步全部个股异动历史（${done}/${codes.length}，失败 ${failed}）`,
        });
      }
    });

    await flushIndividualHistory(true);
    await pruneSurgeHistory(7);

    emitProgress({
      taskType: 'surge',
      status: 'completed',
      processed: totalPhases,
      total: totalPhases,
      message: `已同步 ${items.length} 条异动记录 + ${individualTotal} 条个股异动历史${failed > 0 ? `（${failed} 只股票失败）` : ''}`,
    });
  } catch (error) {
    emitProgress({
      taskType: 'surge',
      status: 'error',
      processed: 0,
      total: 0,
      message: error instanceof Error ? error.message : '异动数据同步失败',
      error: error instanceof Error ? error.message : '未知错误',
    });
    throw error;
  } finally {
    // ponytail: re-enable the background scheduler after a manual sync (unless
    // it is already running) so live capture resumes automatically.
    if (!isSurgeHistorySchedulerRunning()) {
      ensureSurgeHistoryCapture();
    }
    // Notify renderer views to reload so the right-panel surge list and the
    // stock-detail recent-week surge events reflect the newly synced data.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('surge:historyCleared');
      }
    }
  }
}

export async function syncStockDetails() {
  const securities = await listSecurities();
  const listed = securities.filter((s) => s.status === 'listed');
  const total = listed.length;

  if (!total) {
    emitProgress({
      taskType: 'stockDetail',
      status: 'completed',
      processed: 0,
      total: 0,
      message: '无待同步的股票',
    });
    return;
  }

  emitProgress({
    taskType: 'stockDetail',
    status: 'running',
    processed: 0,
    total,
    message: `正在批量获取 ${total} 只股票行情并落盘（batch size 80）…`,
  });

  const { upsertStockSnapshots } = await import('./market-data-store.js');

  let processed = 0;
  let failed = 0;
  const batchSize = 80;
  const codes = listed.map((s) => s.symbol);

  try {
    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize);
      try {
        const quotes = await sdk.batch.byCodes(batch, { batchSize: 80, concurrency: 1 });
        await upsertStockSnapshots(quotes.map((q) => ({
          symbol: q.code,
          name: q.name,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          open: q.open,
          high: q.high,
          low: q.low,
          prevClose: q.prevClose,
          volume: q.volume,
          amount: q.amount,
          turnoverRate: q.turnoverRate ?? undefined,
          pe: q.pe ?? undefined,
          pb: q.pb ?? undefined,
          totalMarketCap: q.totalMarketCap ?? undefined,
          circulatingMarketCap: q.circulatingMarketCap ?? undefined,
          amplitude: q.amplitude ?? undefined,
        })));
        processed += quotes.length;
        failed += batch.length - quotes.length;
      } catch {
        failed += batch.length;
      }

      if (i + batchSize < codes.length) {
        emitProgress({
          taskType: 'stockDetail',
          status: 'running',
          processed,
          total,
          message: `正在获取并落盘行情 ${processed}/${total}（失败 ${failed}）`,
        });
      }
    }

    emitProgress({
      taskType: 'stockDetail',
      status: 'completed',
      processed,
      total,
      message: `已同步 ${processed} 只股票行情${failed > 0 ? `（${failed} 只失败）` : ''}`,
    });
  } catch (error) {
    emitProgress({
      taskType: 'stockDetail',
      status: 'error',
      processed,
      total,
      message: error instanceof Error ? error.message : '个股详情同步失败',
      error: error instanceof Error ? error.message : '未知错误',
    });
    throw error;
  }
}

export async function syncMarketSnapshot() {
  const { getMarketPageSnapshot } = await import('../stock/market-page.js');

  const tabs = ['sh-main', 'sz-main', 'bj', 'gem', 'star'] as const;
  const total = tabs.length;

  emitProgress({
    taskType: 'marketSnapshot',
    status: 'running',
    processed: 0,
    total,
    message: '正在同步行情页快照…',
  });

  let done = 0;
  for (const tab of tabs) {
    try {
      await getMarketPageSnapshot(tab);
    } catch { /* individual tab failure is non-fatal */ }
    done += 1;
    emitProgress({
      taskType: 'marketSnapshot',
      status: 'running',
      processed: done,
      total,
      message: `已同步 ${done}/${total} 个板块`,
    });
  }

  emitProgress({
    taskType: 'marketSnapshot',
    status: 'completed',
    processed: done,
    total,
    message: `行情页快照已同步完成（${done}/${total} 个板块）`,
  });
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) break;
        await worker(items[current]);
      }
    }),
  );
}

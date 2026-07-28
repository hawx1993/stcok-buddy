import { EventEmitter } from 'node:events';
import { resolveTradingDate } from './trade-date-resolver.js';
import { partitionValidDailyBars } from './quality.js';
import { listRemoteSecurities, listRemoteTradingCalendar, stockSdkHistoricalProvider } from './providers.js';
import {
  clearSyncFailure,
  countDailyBarsForDate,
  createSyncJob,
  getLatestSyncJob,
  getLatestTradeDate,
  getMarketDataStats,
  listDailyBars,
  listLatestSyncFailures,
  listSecurities,
  recordSyncFailure,
  updateSyncJob,
  upsertDailyBars,
  upsertSecurities,
  upsertTradingCalendar,
} from './market-data-store.js';
import type { MarketDataSyncStatus, SyncJobType } from './types.js';

const INITIAL_YEARS = 10;
const BOARD_CONCURRENCY = 5;
const FORCE_SYNC_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

type TMarketBoard = 'sh-main' | 'sz-main' | 'bj' | 'gem' | 'star';

function classifyBoard(symbol: string): TMarketBoard {
  if (symbol.startsWith('688')) return 'star';
  if (symbol.startsWith('300') || symbol.startsWith('301')) return 'gem';
  if (symbol.startsWith('4') || symbol.startsWith('8') || symbol.startsWith('92')) return 'bj';
  if (symbol.startsWith('6')) return 'sh-main';
  return 'sz-main';
}
let currentSync: Promise<MarketDataSyncStatus> | undefined;
let stopRequested = false;
let memoryStatus: MarketDataSyncStatus = idleStatus();
const events = new EventEmitter();

export function onMarketDataProgress(listener: (status: MarketDataSyncStatus) => void) {
  events.on('progress', listener);
  return () => events.off('progress', listener);
}

export async function getMarketDataSyncStatus(): Promise<MarketDataSyncStatus> {
  if (currentSync) return memoryStatus;
  const latest = await getLatestSyncJob();
  const latestLocalTradeDate = await getLatestTradeDate();
  return latest
    ? { ...latest, latestLocalTradeDate, message: latest.errorMessage ?? latest.message }
    : { ...idleStatus(), latestLocalTradeDate };
}

export async function startMarketDataSync(force = false) {
  // 手动强制同步 12h 冷却，防止频繁触发被上游限频
  if (force) {
    const lastJob = await getLatestSyncJob();
    if (lastJob?.finishedAt) {
      const elapsed = Date.now() - new Date(lastJob.finishedAt).getTime();
      if (elapsed < FORCE_SYNC_COOLDOWN_MS) {
        const remaining = Math.ceil((FORCE_SYNC_COOLDOWN_MS - elapsed) / 3600_000);
        const msg = `日K线同步已完成，${remaining} 小时后可再次同步`;
        const status: MarketDataSyncStatus = {
          ...memoryStatus,
          state: 'idle' as const,
          message: msg,
        };
        updateMemory(status);
        return status;
      }
    }
  }

  // ponytail: if a sync is already running we cannot just return the old
  // promise when the user explicitly asked for a force sync — the old run
  // may have been started by the scheduler with force=false, and returning
  // it would silently ignore the user's "立即同步" click (the IPC would
  // resolve to the old run's result, often a cancelled 'idle' state, while
  // the UI sits at 0%). For force=true we wait for the current run to finish
  // before kicking off a fresh one.
  if (currentSync) {
    if (!force) return currentSync;
    const chained = currentSync
      .catch(() => undefined)
      .then(() => {
        // Only start the force run if no other sync started in the meantime.
        if (currentSync) return currentSync;
        stopRequested = false;
        currentSync = runSync(true).finally(() => {
          currentSync = undefined;
        });
        return currentSync;
      });
    return chained;
  }
  stopRequested = false;
  currentSync = runSync(force).finally(() => {
    currentSync = undefined;
  });
  return currentSync;
}

export function retryMarketDataFailures() {
  if (currentSync) return currentSync;
  stopRequested = false;
  currentSync = runRepair().finally(() => {
    currentSync = undefined;
  });
  return currentSync;
}

export function requestMarketDataSyncStop(): MarketDataSyncStatus {
  stopRequested = true;
  if (currentSync) {
    const cancelled = {
      ...memoryStatus,
      state: 'idle' as const,
      finishedAt: new Date().toISOString(),
      message: '同步已取消，当前批次将安全停止',
    };
    updateMemory(cancelled);
    return cancelled;
  }
  return memoryStatus;
}

export async function waitForMarketDataSync() {
  await currentSync?.catch(() => undefined);
}

export async function determineTargetTradeDate(now = new Date()) {
  return resolveTradingDate(15 * 60 + 30, now);
}

async function runSync(force: boolean): Promise<MarketDataSyncStatus> {
  // ponytail: emit an immediate 'checking' progress event before any await.
  // The renderer seeds a 0/0 "正在启动同步…" state on click, but if the
  // network-bound determineTargetTradeDate() below takes a few seconds the
  // user sees the bar pinned at 0% with no feedback. Emitting here proves
  // the main process has actually picked up the IPC call.
  updateMemory({
    ...idleStatus(),
    state: 'checking',
    totalSymbols: 0,
    message: '正在确定目标交易日…',
  });
  // 先查询证券列表和目标日期，然后设置合理的初始进度
  const targetTradeDate = await determineTargetTradeDate();
  let securities = await listSecurities();

  // 设置初始进度：使用已知证券数量或合理的预估值
  updateMemory({
    ...idleStatus(),
    state: 'checking',
    targetTradeDate,
    totalSymbols: securities.length || 5000, // 如果本地没有证券，预估5000支
    message: '正在检查本地行情数据',
  });
  if (!securities.length) {
    updateMemory({ ...memoryStatus, state: 'initializing', targetTradeDate, message: '正在同步 A 股证券列表' });
    const remote = await listRemoteSecurities(
      (processed, total) =>
        updateMemory({
          ...memoryStatus,
          processedSymbols: processed,
          totalSymbols: total,
          message: `正在同步 A 股证券列表（${processed}/${total}）`,
        }),
      () => stopRequested,
    );
    if (stopRequested) {
      const cancelled = {
        ...memoryStatus,
        state: 'idle' as const,
        finishedAt: new Date().toISOString(),
        message: '同步已安全停止，下次启动将继续',
      };
      updateMemory(cancelled);
      return cancelled;
    }
    await upsertSecurities(remote);
    securities = remote;
  }
  if (stopRequested) {
    const cancelled = {
      ...memoryStatus,
      state: 'idle' as const,
      finishedAt: new Date().toISOString(),
      message: '同步已安全停止，下次启动将继续',
    };
    updateMemory(cancelled);
    return cancelled;
  }
  const calendar = await listRemoteTradingCalendar();
  await upsertTradingCalendar(calendar);

  const latestTradeDate = await getLatestTradeDate();
  if (!force && latestTradeDate && latestTradeDate >= targetTradeDate) {
    const done = {
      ...idleStatus(),
      state: 'completed' as const,
      targetTradeDate,
      latestLocalTradeDate: latestTradeDate,
      message: '本地行情已是最新',
    };
    updateMemory(done);
    return done;
  }

  const jobType: SyncJobType = latestTradeDate ? 'daily_incremental' : 'initial_backfill';
  const previous = await getLatestSyncJob();
  const checkpoint =
    previous?.status === 'running' && previous.jobType === jobType && previous.targetTradeDate === targetTradeDate
      ? previous.checkpointSymbol
      : undefined;
  const symbols = checkpoint ? securities.filter((item) => item.symbol > checkpoint) : securities;
  const jobId = `market-sync-${Date.now()}`;
  await createSyncJob({
    id: jobId,
    jobType,
    targetTradeDate,
    totalSymbols: securities.length,
    checkpointSymbol: checkpoint,
  });

  const startDate = latestTradeDate ? dayAfter(latestTradeDate) : yearsAgo(targetTradeDate, INITIAL_YEARS);
  const baseProcessed = securities.length - symbols.length;
  let processed = baseProcessed;
  let succeeded = 0;
  let failed = 0;
  updateMemory({
    state: jobType === 'initial_backfill' ? 'initializing' : 'syncing',
    jobType,
    targetTradeDate,
    processedSymbols: processed,
    totalSymbols: securities.length,
    succeededSymbols: 0,
    failedSymbols: 0,
    startedAt: new Date().toISOString(),
    latestLocalTradeDate: latestTradeDate,
    message: jobType === 'initial_backfill' ? '正在后台回填最近 10 年日线' : '正在同步最新交易日数据',
  });

  // ponytail: when force=true, ignore existing bars and always pull latest day
  // so the user sees real progress and gets guaranteed fresh data
  const forceDownload = force;

  // Group by exchange board for parallel sync
  const boardGroups = new Map<TMarketBoard, typeof symbols>();
  for (const security of symbols) {
    const board = classifyBoard(security.symbol);
    const list = boardGroups.get(board) ?? [];
    list.push(security);
    boardGroups.set(board, list);
  }

  const boardLabels: Record<TMarketBoard, string> = {
    'sh-main': '上海主板',
    'sz-main': '深证主板',
    bj: '北交所',
    gem: '创业板',
    star: '科创板',
  };

  const worker = async (security: (typeof symbols)[number]) => {
    if (stopRequested) return;
    try {
      const existing = await listDailyBars(security.symbol, { limit: 1, adjustType: 'qfq' });
      const symbolStart =
        existing.at(-1)?.tradeDate && !forceDownload ? dayAfter(existing.at(-1)!.tradeDate) : startDate;
      if (forceDownload || symbolStart <= targetTradeDate) {
        const rows = await stockSdkHistoricalProvider.getDailyBars(security.symbol, {
          adjustType: 'qfq',
          startDate: symbolStart,
          endDate: targetTradeDate,
        });
        const { valid, invalid } = partitionValidDailyBars(rows);
        if (valid.length) await upsertDailyBars(valid);
        if (invalid.length) console.warn(`[market-data] ${security.symbol} ignored ${invalid.length} invalid bars`);
      }
      await clearSyncFailure(jobId, security.symbol, 'daily-bars');
      succeeded += 1;
    } catch (error) {
      failed += 1;
      await recordSyncFailure(
        jobId,
        security.symbol,
        'daily-bars',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      processed += 1;
      await updateSyncJob(jobId, {
        processedSymbols: processed,
        succeededSymbols: succeeded,
        failedSymbols: failed,
        checkpointSymbol: security.symbol,
      });
      updateMemory({
        ...memoryStatus,
        processedSymbols: processed,
        succeededSymbols: succeeded,
        failedSymbols: failed,
        message: `正在同步日K线（${processed}/${memoryStatus.totalSymbols}）`,
        latestLocalTradeDate: latestTradeDate,
      });
    }
  };

  // Run all 5 boards in parallel, each with its own concurrency
  await Promise.all(
    [...boardGroups.entries()].map(([board, boardSymbols]) =>
      runPool(boardSymbols, BOARD_CONCURRENCY, worker).then(() => {
        // eslint-disable-next-line no-console
        console.log(`[market-data] board ${boardLabels[board]} done: ${boardSymbols.length} stocks`);
      }),
    ),
  );

  if (stopRequested) {
    await updateSyncJob(jobId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      errorMessage: '应用退出，同步已在当前批次后停止',
    });
    const cancelled = {
      ...memoryStatus,
      state: 'idle' as const,
      finishedAt: new Date().toISOString(),
      message: '同步已安全停止，下次启动将继续',
    };
    updateMemory(cancelled);
    return cancelled;
  }

  // ponytail: wrap the finalization queries in a timeout. If DuckDB has become
  // unresponsive (e.g. after heavy connection churn during the pool) a hanging
  // count/update here would otherwise prevent the 'completed' event from ever
  // being emitted, leaving the UI stuck at 100% "同步中" forever. On timeout we
  // fall back to the in-memory counters so runSync ALWAYS returns a final state.
  let covered = 0;
  let coverage = 0;
  let status: MarketDataSyncStatus['state'];
  try {
    covered = await withTimeout(countDailyBarsForDate(targetTradeDate), 10000);
    coverage = securities.length ? covered / securities.length : 0;
    status = coverage >= 0.99 ? 'completed' : coverage >= 0.95 ? 'partial' : failed ? 'failed' : 'partial';
  } catch (error) {
    console.warn('[market-data] finalize coverage query timed out, falling back to counters', error);
    status = failed ? 'partial' : 'completed';
  }
  const finishedAt = new Date().toISOString();
  await withTimeout(
    updateSyncJob(jobId, { status, finishedAt, metadataJson: JSON.stringify({ covered, coverage }) }),
    10000,
  ).catch((error) => console.warn('[market-data] finalize updateSyncJob timed out', error));
  const latestLocal = await withTimeout(getLatestTradeDate(), 10000).catch(() => latestTradeDate);
  const result: MarketDataSyncStatus = {
    ...memoryStatus,
    state: status,
    finishedAt,
    latestLocalTradeDate: latestLocal,
    message: `同步完成，目标日覆盖 ${(coverage * 100).toFixed(1)}%`,
  };
  updateMemory(result);
  return result;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('finalize query timeout')), ms)),
  ]);
}

async function runRepair(): Promise<MarketDataSyncStatus> {
  const failures = await listLatestSyncFailures();
  if (!failures.length) return getMarketDataSyncStatus();
  updateMemory({
    ...idleStatus(),
    state: 'syncing',
    jobType: 'repair',
    totalSymbols: failures.length,
    message: '正在重试失败股票',
  });
  const target = await determineTargetTradeDate();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  for (const item of failures) {
    if (stopRequested) break;
    try {
      const latest = await listDailyBars(item.symbol, { limit: 1, adjustType: 'qfq' });
      const rows = await stockSdkHistoricalProvider.getDailyBars(item.symbol, {
        adjustType: 'qfq',
        startDate: latest[0] ? dayAfter(latest[0].tradeDate) : yearsAgo(target, INITIAL_YEARS),
        endDate: target,
      });
      const { valid } = partitionValidDailyBars(rows);
      if (valid.length) await upsertDailyBars(valid);
      await clearSyncFailure(item.jobId, item.symbol, item.stage);
      succeeded += 1;
    } catch {
      failed += 1;
    }
    processed += 1;
    updateMemory({ ...memoryStatus, processedSymbols: processed, succeededSymbols: succeeded, failedSymbols: failed });
  }
  if (stopRequested) {
    const cancelled = {
      ...memoryStatus,
      state: 'idle' as const,
      finishedAt: new Date().toISOString(),
      latestLocalTradeDate: await getLatestTradeDate(),
      message: '同步已取消，当前批次将安全停止',
    };
    updateMemory(cancelled);
    return cancelled;
  }
  const result = {
    ...memoryStatus,
    state: failed ? ('partial' as const) : ('completed' as const),
    finishedAt: new Date().toISOString(),
    latestLocalTradeDate: await getLatestTradeDate(),
    message: failed ? '部分失败股票仍未补齐' : '失败股票已重试完成',
  };
  updateMemory(result);
  return result;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!stopRequested) {
        const current = index++;
        if (current >= items.length) break;
        await worker(items[current]);
      }
    }),
  );
}

function updateMemory(status: MarketDataSyncStatus) {
  memoryStatus = status;
  events.emit('progress', status);
}

function idleStatus(): MarketDataSyncStatus {
  return { state: 'idle', processedSymbols: 0, totalSymbols: 0, succeededSymbols: 0, failedSymbols: 0 };
}
function yearsAgo(target: string, years: number) {
  const date = new Date(`${target}T12:00:00+08:00`);
  date.setFullYear(date.getFullYear() - years);
  return isoDate(date);
}
function dayAfter(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() + 1);
  return isoDate(date);
}
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export { getMarketDataStats };

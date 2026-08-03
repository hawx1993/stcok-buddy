import { parentPort } from 'node:worker_threads';
import { expose } from 'comlink';
import { nodeEndpoint } from '../stock/comlink-node-endpoint.js';
import { resolveTradingDate } from './trade-date-resolver.js';
import { partitionValidDailyBars } from './quality.js';
import { listRemoteSecurities, listRemoteTradingCalendar, stockSdkHistoricalProvider } from './providers.js';
import {
  clearSyncFailure,
  countDailyBarsForDate,
  createSyncJob,
  getLatestSyncJob,
  getLatestTradeDate,
  listDailyBars,
  listLatestSyncFailures,
  listSecurities,
  recordSyncFailure,
  updateSyncJob,
  upsertDailyBars,
  upsertSecurities,
  upsertTradingCalendar,
} from './market-data-store.js';
import type { IMarketDataSyncWorkerApi, TMarketDataProgressListener } from './market-data-sync-worker-types.js';
import type { MarketDataSyncStatus, SyncJobType } from './types.js';

if (!parentPort) throw new Error('market data sync worker requires parentPort');

const INITIAL_YEARS = 10;
const BOARD_CONCURRENCY = 5;

type TMarketBoard = 'sh-main' | 'sz-main' | 'bj' | 'gem' | 'star';

let stopRequested = false;
let memoryStatus: MarketDataSyncStatus = idleStatus();

const api: IMarketDataSyncWorkerApi = {
  async runSync({ force, onProgress }) {
    stopRequested = false;
    return runSync(force, onProgress);
  },

  async runRepair(onProgress) {
    stopRequested = false;
    return runRepair(onProgress);
  },

  async requestStop() {
    stopRequested = true;
  },
};

async function determineTargetTradeDate(now = new Date()) {
  return resolveTradingDate(15 * 60 + 30, now);
}

async function runSync(force: boolean, onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus> {
  updateMemory(
    {
      ...idleStatus(),
      state: 'checking',
      totalSymbols: 0,
      message: '正在确定目标交易日…',
    },
    onProgress,
  );

  const targetTradeDate = await determineTargetTradeDate();
  let securities = await listSecurities();

  updateMemory(
    {
      ...idleStatus(),
      state: 'checking',
      targetTradeDate,
      totalSymbols: securities.length || 5000,
      message: '正在检查本地行情数据',
    },
    onProgress,
  );

  if (!securities.length) {
    updateMemory({ ...memoryStatus, state: 'initializing', targetTradeDate, message: '正在同步 A 股证券列表' }, onProgress);
    const remote = await listRemoteSecurities(
      (processed, total) =>
        updateMemory(
          {
            ...memoryStatus,
            processedSymbols: processed,
            totalSymbols: total,
            message: `正在同步 A 股证券列表（${processed}/${total}）`,
          },
          onProgress,
        ),
      () => stopRequested,
    );
    if (stopRequested) return cancelledStatus(onProgress, '同步已安全停止，下次启动将继续');
    await upsertSecurities(remote);
    securities = remote;
  }

  if (stopRequested) return cancelledStatus(onProgress, '同步已安全停止，下次启动将继续');

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
    updateMemory(done, onProgress);
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
  updateMemory(
    {
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
    },
    onProgress,
  );

  const forceDownload = force;
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
      const symbolStart = existing.at(-1)?.tradeDate && !forceDownload ? dayAfter(existing.at(-1)!.tradeDate) : startDate;
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
      updateMemory(
        {
          ...memoryStatus,
          processedSymbols: processed,
          succeededSymbols: succeeded,
          failedSymbols: failed,
          message: `正在同步日K线（${processed}/${memoryStatus.totalSymbols}）`,
          latestLocalTradeDate: latestTradeDate,
        },
        onProgress,
      );
    }
  };

  await Promise.all(
    [...boardGroups.entries()].map(([board, boardSymbols]) =>
      runPool(boardSymbols, BOARD_CONCURRENCY, worker).then(() => {
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
    return cancelledStatus(onProgress, '同步已安全停止，下次启动将继续');
  }

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
  updateMemory(result, onProgress);
  return result;
}

async function runRepair(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus> {
  const failures = await listLatestSyncFailures();
  if (!failures.length) return memoryStatus;
  updateMemory(
    {
      ...idleStatus(),
      state: 'syncing',
      jobType: 'repair',
      totalSymbols: failures.length,
      message: '正在重试失败股票',
    },
    onProgress,
  );
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
    updateMemory({ ...memoryStatus, processedSymbols: processed, succeededSymbols: succeeded, failedSymbols: failed }, onProgress);
  }
  if (stopRequested) return cancelledStatus(onProgress, '同步已取消，当前批次将安全停止');
  const result = {
    ...memoryStatus,
    state: failed ? ('partial' as const) : ('completed' as const),
    finishedAt: new Date().toISOString(),
    latestLocalTradeDate: await getLatestTradeDate(),
    message: failed ? '部分失败股票仍未补齐' : '失败股票已重试完成',
  };
  updateMemory(result, onProgress);
  return result;
}

function classifyBoard(symbol: string): TMarketBoard {
  if (symbol.startsWith('688')) return 'star';
  if (symbol.startsWith('300') || symbol.startsWith('301')) return 'gem';
  if (symbol.startsWith('4') || symbol.startsWith('8') || symbol.startsWith('92')) return 'bj';
  if (symbol.startsWith('6')) return 'sh-main';
  return 'sz-main';
}

function cancelledStatus(onProgress: TMarketDataProgressListener, message: string): MarketDataSyncStatus {
  const cancelled = {
    ...memoryStatus,
    state: 'idle' as const,
    finishedAt: new Date().toISOString(),
    message,
  };
  updateMemory(cancelled, onProgress);
  return cancelled;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('finalize query timeout')), ms)),
  ]);
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

function updateMemory(status: MarketDataSyncStatus, onProgress: TMarketDataProgressListener) {
  memoryStatus = status;
  onProgress(status);
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

expose(api, nodeEndpoint(parentPort));

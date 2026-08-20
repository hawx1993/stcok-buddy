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
  getLatestTradeDate,
  getResumableDailySyncJob,
  listDailyBarCoverageCandidates,
  listDailyBars,
  listLatestSyncFailures,
  listSecurities,
  recordSyncFailure,
  updateSyncJob,
  upsertDailyBars,
  upsertSecurities,
  upsertTradingCalendar,
} from '../stock-db/market-data-store.js';
import {
  INITIAL_YEARS,
  RECENT_TRADING_DAYS,
  dayAfter,
  historicalBackfillRange,
  isValidDateRange,
  recentStartDate,
  sortSecuritiesForSync,
  splitSyncBatches,
  yearsAgo,
} from './market-data-sync-plan.js';
import type {
  IMarketDataCoverageSyncOptions,
  IMarketDataSyncWorkerApi,
  TMarketDataProgressListener,
} from './market-data-sync-worker-types.js';
import type {
  DailyBarRecord,
  IDailyBarCoverageCandidate,
  MarketDataSyncStatus,
  SyncJobRecord,
  SyncJobType,
} from './types.js';

if (!parentPort) throw new Error('market data sync worker requires parentPort');

const SYNC_BATCH_SIZE = 10;
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

let stopRequested = false;
let memoryStatus: MarketDataSyncStatus = idleStatus();

type TUnresolvedFailureStages = Map<string, Set<string>>;

const api: IMarketDataSyncWorkerApi = {
  async runSync(onProgress) {
    stopRequested = false;
    return runSync(onProgress);
  },

  async runCoverageSync(options, onProgress) {
    stopRequested = false;
    return runCoverageSync(options, onProgress);
  },

  async runRepair(onProgress) {
    stopRequested = false;
    return runRepair(onProgress);
  },

  async runHistoricalBackfill(onProgress) {
    stopRequested = false;
    return runHistoricalBackfill(onProgress);
  },

  async requestStop() {
    stopRequested = true;
  },
};

async function determineTargetTradeDate(now = new Date()) {
  return resolveTradingDate(15 * 60 + 30, now);
}

async function runSync(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus> {
  const { targetTradeDate, securities, calendar, latestTradeDate } = await prepareSync(onProgress);
  if (stopRequested) return cancelledStatus(onProgress, '同步已安全停止，下次启动将继续');

  const candidates = await listDailyBarCoverageCandidates(targetTradeDate);
  const resumeJob = await getResumableDailySyncJob(targetTradeDate, resumeCheckpointAfter());
  if (!candidates.length) {
    if (resumeJob) {
      const finishedAt = new Date().toISOString();
      await updateSyncJob(resumeJob.id, {
        status: 'completed',
        finishedAt,
        checkpointAt: finishedAt,
        errorMessage: '',
      });
    }
    const done = {
      ...idleStatus(),
      state: 'completed' as const,
      targetTradeDate,
      latestLocalTradeDate: latestTradeDate,
      message: '没有可更新的数据，本地日K已是最新',
    };
    updateMemory(done, onProgress);
    return done;
  }

  const resumeCandidates = resumeJob?.checkpointSymbol
    ? await listDailyBarCoverageCandidates(targetTradeDate, resumeJob.checkpointSymbol)
    : candidates;
  if (!resumeCandidates.length) {
    const finishedAt = new Date().toISOString();
    if (resumeJob) {
      await updateSyncJob(resumeJob.id, {
        status: 'partial',
        finishedAt,
        checkpointAt: finishedAt,
        errorMessage: '检查点前仍有未补齐日K，请重试失败股票',
      });
    }
    const partial = {
      ...idleStatus(),
      state: 'partial' as const,
      targetTradeDate,
      latestLocalTradeDate: latestTradeDate,
      message: '检查点后没有可更新的数据，检查点前仍有未补齐日K',
    };
    updateMemory(partial, onProgress);
    return partial;
  }

  const recentStart = recentStartDate(calendar, targetTradeDate, RECENT_TRADING_DAYS);
  const isInitial = resumeJob?.jobType === 'recent_initial' || !latestTradeDate;
  const jobType: SyncJobType = isInitial ? 'recent_initial' : 'daily_incremental';
  const result = await runSyncWindow({
    jobType,
    phase: isInitial ? 'recent' : undefined,
    targetTradeDate,
    latestTradeDate,
    securities: resumeCandidates,
    totalSymbols: resumeJob?.totalSymbols ?? candidates.length,
    expectedCoverage: securities.length,
    resumeJob,
    startDate: recentStart,
    endDate: targetTradeDate,
    forceDownload: false,
    initialState: isInitial ? 'initializing' : 'syncing',
    startMessage: isInitial ? '正在同步近期日K线，历史数据稍后后台补齐' : '正在同步最新交易日数据',
    progressMessage: isInitial ? '正在同步近期日K线' : '正在同步最新日K线',
    onProgress,
  });

  if (isInitial && result.state !== 'failed') {
    const withBackfill: MarketDataSyncStatus = {
      ...result,
      phase: 'recent',
      backfillPending: Boolean(historicalBackfillRange(targetTradeDate, recentStart)),
      message: `${result.message ?? '近期日K同步完成'}，历史数据将在后台补齐`,
    };
    updateMemory(withBackfill, onProgress);
    return withBackfill;
  }
  return result;
}

async function runCoverageSync(
  options: IMarketDataCoverageSyncOptions,
  onProgress: TMarketDataProgressListener,
): Promise<MarketDataSyncStatus> {
  const minCoverage = Number.isFinite(options.minCoverage) ? Math.max(1, Math.floor(options.minCoverage)) : 1;
  updateMemory(
    {
      ...idleStatus(),
      state: 'checking',
      targetTradeDate: options.targetTradeDate,
      message: `正在检查 ${options.targetTradeDate} 本地日K覆盖度`,
    },
    onProgress,
  );

  const [covered, latestTradeDate] = await Promise.all([
    countDailyBarsForDate(options.targetTradeDate),
    getLatestTradeDate(),
  ]);
  if (covered >= minCoverage) {
    const done = {
      ...idleStatus(),
      state: 'completed' as const,
      jobType: 'daily_incremental' as const,
      targetTradeDate: options.targetTradeDate,
      latestLocalTradeDate: latestTradeDate,
      message: `DuckDB 已覆盖 ${options.targetTradeDate} 日K（${covered}/${minCoverage}）`,
    };
    updateMemory(done, onProgress);
    return done;
  }

  const [calendar, candidates] = await Promise.all([
    listRemoteTradingCalendar(),
    listDailyBarCoverageCandidates(options.targetTradeDate),
  ]);
  await upsertTradingCalendar(calendar);
  if (stopRequested) return cancelledStatus(onProgress, '同步已安全停止，下次启动将继续');

  if (!candidates.length) {
    const partial = {
      ...idleStatus(),
      state: 'partial' as const,
      jobType: 'daily_incremental' as const,
      targetTradeDate: options.targetTradeDate,
      latestLocalTradeDate: latestTradeDate,
      message: `目标日K覆盖不足（${covered}/${minCoverage}），但没有可补齐证券`,
    };
    updateMemory(partial, onProgress);
    return partial;
  }

  const recentStart = recentStartDate(calendar, options.targetTradeDate, RECENT_TRADING_DAYS);
  return runSyncWindow({
    jobType: 'daily_incremental',
    targetTradeDate: options.targetTradeDate,
    latestTradeDate,
    securities: candidates,
    startDate: recentStart,
    endDate: options.targetTradeDate,
    forceDownload: false,
    initialState: 'syncing',
    startMessage: `正在补齐 ${options.targetTradeDate} 缺失日K（当前 ${covered}/${minCoverage}）`,
    progressMessage: '正在同步缺失日K',
    minCoverage,
    initialCoverage: covered,
    onProgress,
  });
}

async function runHistoricalBackfill(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus> {
  const { targetTradeDate, securities, calendar, latestTradeDate } = await prepareSync(onProgress);
  if (stopRequested) return cancelledStatus(onProgress, '同步已安全停止，下次启动将继续');
  const recentStart = recentStartDate(calendar, targetTradeDate, RECENT_TRADING_DAYS);
  const range = historicalBackfillRange(targetTradeDate, recentStart);
  if (!range) {
    const done = {
      ...idleStatus(),
      state: 'completed' as const,
      phase: 'historical' as const,
      targetTradeDate,
      latestLocalTradeDate: latestTradeDate,
      message: '历史日K无需补齐',
    };
    updateMemory(done, onProgress);
    return done;
  }
  return runSyncWindow({
    jobType: 'historical_backfill',
    phase: 'historical',
    targetTradeDate,
    latestTradeDate,
    securities,
    startDate: range.startDate,
    endDate: range.endDate,
    forceDownload: true,
    initialState: 'syncing',
    startMessage: '正在后台补齐历史日K',
    progressMessage: '正在后台补齐历史日K',
    onProgress,
  });
}

async function prepareSync(onProgress: TMarketDataProgressListener) {
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
    updateMemory(
      { ...memoryStatus, state: 'initializing', targetTradeDate, message: '正在同步 A 股证券列表' },
      onProgress,
    );
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
    if (!stopRequested) {
      await upsertSecurities(remote);
      securities = remote;
    }
  }

  const calendar = await listRemoteTradingCalendar();
  await upsertTradingCalendar(calendar);
  const latestTradeDate = await getLatestTradeDate();
  return { targetTradeDate, securities: sortSecuritiesForSync(securities), calendar, latestTradeDate };
}

async function runSyncWindow(options: {
  jobType: SyncJobType;
  phase?: 'recent' | 'historical';
  targetTradeDate: string;
  latestTradeDate?: string;
  securities: IDailyBarCoverageCandidate[];
  totalSymbols?: number;
  expectedCoverage?: number;
  resumeJob?: SyncJobRecord;
  startDate: string;
  endDate: string;
  forceDownload: boolean;
  initialState: 'initializing' | 'syncing';
  startMessage: string;
  progressMessage: string;
  minCoverage?: number;
  initialCoverage?: number;
  onProgress: TMarketDataProgressListener;
}): Promise<MarketDataSyncStatus> {
  const totalSymbols = options.totalSymbols ?? options.securities.length;
  const jobId = options.resumeJob?.id ?? `market-sync-${Date.now()}`;
  if (options.resumeJob) {
    await updateSyncJob(jobId, { status: 'running', errorMessage: '' });
  } else {
    await createSyncJob({
      id: jobId,
      jobType: options.jobType,
      targetTradeDate: options.targetTradeDate,
      totalSymbols,
    });
  }

  const unresolvedFailureStages = createUnresolvedFailureStages(
    options.resumeJob ? await listLatestSyncFailures() : [],
  );
  let processed = Math.min(options.resumeJob?.processedSymbols ?? 0, totalSymbols);
  let succeeded = options.resumeJob?.succeededSymbols ?? 0;
  let failed = unresolvedFailureStages.size;
  const initialCoverage = options.initialCoverage ?? 0;
  const newlyCoveredSymbols = new Set<string>();
  let coverageTargetReached = false;
  updateMemory(
    {
      state: options.initialState,
      jobType: options.jobType,
      phase: options.phase,
      targetTradeDate: options.targetTradeDate,
      processedSymbols: processed,
      totalSymbols,
      succeededSymbols: succeeded,
      failedSymbols: failed,
      startedAt: options.resumeJob?.startedAt ?? new Date().toISOString(),
      latestLocalTradeDate: options.latestTradeDate,
      message: options.startMessage,
    },
    options.onProgress,
  );

  const batches = splitSyncBatches(options.securities, SYNC_BATCH_SIZE);

  const processBatch = async (batch: IDailyBarCoverageCandidate[]) => {
    if (stopRequested || coverageTargetReached) return;
    const batchBars: DailyBarRecord[] = [];
    const batchFailures: { symbol: string; message: string }[] = [];
    const batchSuccesses: string[] = [];

    await Promise.all(
      batch.map(async (security) => {
        if (stopRequested) return;
        try {
          const localLatestTradeDate = options.forceDownload
            ? undefined
            : Object.prototype.hasOwnProperty.call(security, 'latestTradeDate')
              ? security.latestTradeDate
              : (await listDailyBars(security.symbol, { limit: 1, adjustType: 'qfq' })).at(-1)?.tradeDate;
          const incrementalStart = localLatestTradeDate ? dayAfter(localLatestTradeDate) : options.startDate;
          const symbolStart = incrementalStart > options.startDate ? incrementalStart : options.startDate;
          if (!isValidDateRange(symbolStart, options.endDate)) {
            batchSuccesses.push(security.symbol);
            return;
          }
          const rows = await stockSdkHistoricalProvider.getDailyBars(security.symbol, {
            adjustType: 'qfq',
            startDate: symbolStart,
            endDate: options.endDate,
          });
          const { valid, invalid } = partitionValidDailyBars(rows);
          if (valid.length) batchBars.push(...valid);
          if (invalid.length) console.warn(`[market-data] ${security.symbol} ignored ${invalid.length} invalid bars`);
          batchSuccesses.push(security.symbol);
        } catch (error) {
          batchFailures.push({
            symbol: security.symbol,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    if (batchBars.length) {
      try {
        await upsertDailyBars(batchBars);
        for (const bar of batchBars) {
          if (bar.tradeDate === options.targetTradeDate && bar.adjustType === 'qfq') {
            newlyCoveredSymbols.add(bar.symbol);
          }
        }
        coverageTargetReached =
          options.minCoverage !== undefined && initialCoverage + newlyCoveredSymbols.size >= options.minCoverage;
      } catch (error) {
        console.warn('[market-data] batch upsert failed', error);
        for (const bar of batchBars) {
          if (!batchFailures.some((f) => f.symbol === bar.symbol)) {
            batchFailures.push({ symbol: bar.symbol, message: '批量写入日K失败' });
          }
        }
        for (const symbol of batchSuccesses) {
          if (batchBars.some((bar) => bar.symbol === symbol)) {
            const idx = batchSuccesses.indexOf(symbol);
            if (idx >= 0) batchSuccesses.splice(idx, 1);
          }
        }
      }
    }

    for (const { symbol, message } of batchFailures) {
      await recordSyncFailure(jobId, symbol, 'daily-bars', message);
      addUnresolvedFailureStage(unresolvedFailureStages, symbol, 'daily-bars');
    }
    for (const symbol of batchSuccesses) {
      if (!unresolvedFailureStages.has(symbol)) continue;
      await clearSyncFailure(jobId, symbol, 'daily-bars');
      clearUnresolvedFailureStage(unresolvedFailureStages, symbol, 'daily-bars');
    }

    succeeded += batchSuccesses.length;
    failed = unresolvedFailureStages.size;
    processed += batch.length;

    const lastSymbol = batch.at(-1)?.symbol;
    await updateSyncJob(jobId, {
      processedSymbols: processed,
      succeededSymbols: succeeded,
      failedSymbols: failed,
      checkpointSymbol: lastSymbol,
      checkpointAt: new Date().toISOString(),
    });
    updateMemory(
      {
        ...memoryStatus,
        processedSymbols: processed,
        succeededSymbols: succeeded,
        failedSymbols: failed,
        message: `${options.progressMessage}（${processed}/${memoryStatus.totalSymbols}）`,
        latestLocalTradeDate: options.latestTradeDate,
      },
      options.onProgress,
    );
  };

  for (const batch of batches) {
    if (stopRequested || coverageTargetReached) break;
    await processBatch(batch);
  }

  if (stopRequested) {
    const finishedAt = new Date().toISOString();
    await updateSyncJob(jobId, {
      status: 'cancelled',
      finishedAt,
      checkpointAt: finishedAt,
      errorMessage: '应用退出，同步已在当前批次后停止',
    });
    return cancelledStatus(options.onProgress, '同步已安全停止，下次启动将继续');
  }

  let covered = 0;
  let coverage = 0;
  let status: MarketDataSyncStatus['state'];
  const requiredCoverage = options.minCoverage ?? options.expectedCoverage ?? totalSymbols;
  try {
    covered = await withTimeout(countDailyBarsForDate(options.targetTradeDate), 10000);
    coverage = requiredCoverage ? Math.min(1, covered / requiredCoverage) : 1;
    status =
      options.minCoverage !== undefined
        ? covered >= requiredCoverage
          ? 'completed'
          : 'partial'
        : options.phase === 'historical'
          ? failed
            ? 'partial'
            : 'completed'
          : coverage >= 0.99
            ? 'completed'
            : coverage >= 0.95
              ? 'partial'
              : failed
                ? 'failed'
                : 'partial';
  } catch (error) {
    console.warn('[market-data] finalize coverage query timed out, falling back to counters', error);
    status = failed ? 'partial' : 'completed';
  }
  const finishedAt = new Date().toISOString();
  await withTimeout(
    updateSyncJob(jobId, {
      status,
      finishedAt,
      metadataJson: JSON.stringify({ covered, coverage, requiredCoverage }),
    }),
    10000,
  ).catch((error) => console.warn('[market-data] finalize updateSyncJob timed out', error));
  const latestLocal = await withTimeout(getLatestTradeDate(), 10000).catch(() => options.latestTradeDate);
  const result: MarketDataSyncStatus = {
    ...memoryStatus,
    state: status,
    phase: options.phase,
    finishedAt,
    latestLocalTradeDate: latestLocal,
    message:
      options.minCoverage !== undefined
        ? `同步完成，目标日覆盖 ${covered}/${requiredCoverage}`
        : `${options.phase === 'historical' ? '历史日K补齐完成' : '同步完成'}，目标日覆盖 ${(coverage * 100).toFixed(1)}%`,
  };
  updateMemory(result, options.onProgress);
  return result;
}

async function runRepair(onProgress: TMarketDataProgressListener): Promise<MarketDataSyncStatus> {
  const failures = await listLatestSyncFailures();
  const unresolvedFailureStages = createUnresolvedFailureStages(failures);
  if (!failures.length) {
    const result: MarketDataSyncStatus = {
      ...idleStatus(),
      state: 'completed',
      finishedAt: new Date().toISOString(),
      latestLocalTradeDate: await getLatestTradeDate(),
      message: '没有需要重试的失败股票',
    };
    updateMemory(result, onProgress);
    return result;
  }
  updateMemory(
    {
      ...idleStatus(),
      state: 'syncing',
      jobType: 'repair',
      totalSymbols: failures.length,
      failedSymbols: unresolvedFailureStages.size,
      message: '正在重试失败股票',
    },
    onProgress,
  );
  const target = await determineTargetTradeDate();
  let processed = 0;
  let succeeded = 0;
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
      clearUnresolvedFailureStage(unresolvedFailureStages, item.symbol, item.stage);
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordSyncFailure(item.jobId, item.symbol, item.stage, message);
      console.warn(`[market-data] retry failed for ${item.symbol}`, error);
    }
    processed += 1;
    await updateSyncJob(item.jobId, { failedSymbols: unresolvedFailureStages.size });
    updateMemory(
      {
        ...memoryStatus,
        processedSymbols: processed,
        succeededSymbols: succeeded,
        failedSymbols: unresolvedFailureStages.size,
      },
      onProgress,
    );
  }
  if (stopRequested) return cancelledStatus(onProgress, '同步已取消，当前批次将安全停止');
  const finishedAt = new Date().toISOString();
  const state = unresolvedFailureStages.size ? ('partial' as const) : ('completed' as const);
  await updateSyncJob(failures[0].jobId, {
    status: state,
    failedSymbols: unresolvedFailureStages.size,
    finishedAt,
    errorMessage: unresolvedFailureStages.size ? '部分失败股票仍未补齐' : '',
  });
  const result: MarketDataSyncStatus = {
    ...memoryStatus,
    state,
    failedSymbols: unresolvedFailureStages.size,
    finishedAt,
    latestLocalTradeDate: await getLatestTradeDate(),
    message: unresolvedFailureStages.size ? '部分失败股票仍未补齐' : '失败股票已重试完成',
  };
  updateMemory(result, onProgress);
  return result;
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

function resumeCheckpointAfter(now = Date.now()) {
  return new Date(now - RESUME_WINDOW_MS).toISOString();
}

function createUnresolvedFailureStages(
  failures: Array<{ symbol: string; stage: string }>,
): TUnresolvedFailureStages {
  const unresolvedFailureStages: TUnresolvedFailureStages = new Map();
  for (const failure of failures) {
    addUnresolvedFailureStage(unresolvedFailureStages, failure.symbol, failure.stage);
  }
  return unresolvedFailureStages;
}

function addUnresolvedFailureStage(
  unresolvedFailureStages: TUnresolvedFailureStages,
  symbol: string,
  stage: string,
) {
  const stages = unresolvedFailureStages.get(symbol) ?? new Set<string>();
  stages.add(stage);
  unresolvedFailureStages.set(symbol, stages);
}

function clearUnresolvedFailureStage(
  unresolvedFailureStages: TUnresolvedFailureStages,
  symbol: string,
  stage: string,
) {
  const stages = unresolvedFailureStages.get(symbol);
  if (!stages) return;
  stages.delete(stage);
  if (!stages.size) unresolvedFailureStages.delete(symbol);
}

function updateMemory(status: MarketDataSyncStatus, onProgress: TMarketDataProgressListener) {
  memoryStatus = status;
  onProgress(status);
}

function idleStatus(): MarketDataSyncStatus {
  return { state: 'idle', processedSymbols: 0, totalSymbols: 0, succeededSymbols: 0, failedSymbols: 0 };
}

expose(api, nodeEndpoint(parentPort));

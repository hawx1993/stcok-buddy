import { EventEmitter } from 'node:events';
import { resolveTradingDate } from './trade-date-resolver.js';
import { getLatestSyncJob, getLatestTradeDate, getMarketDataStats } from '../stock-db/market-data-store.js';
import {
  requestMarketDataWorkerStop,
  retryMarketDataFailuresInWorker,
  runHistoricalBackfillInWorker,
  runMarketDataCoverageSyncInWorker,
  runMarketDataSyncInWorker,
} from './market-data-sync-worker-client.js';
import type { IMarketDataCoverageSyncOptions } from './market-data-sync-worker-types.js';
import type { MarketDataSyncStatus, SyncJobRecord } from './types.js';

const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

let currentSync: Promise<MarketDataSyncStatus> | undefined;
let stopRequested = false;
let historicalBackfillQueued = false;
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
  if (latest && isInterruptedDailySyncJob(latest)) {
    return {
      ...idleStatus(),
      failedSymbols: latest.failedSymbols,
      latestLocalTradeDate,
      message: isCheckpointResumable(latest)
        ? '上次同步未完成，点击立即同步将从检查点继续'
        : '上次同步已超过 24 小时，本次将重新检查缺口',
    };
  }
  if (latest?.status === 'running') {
    return {
      ...idleStatus(),
      failedSymbols: latest.failedSymbols,
      latestLocalTradeDate,
      message: '上次同步未完成，请点击立即同步继续',
    };
  }
  return latest
    ? { ...latest, latestLocalTradeDate, message: latest.errorMessage ?? latest.message }
    : { ...idleStatus(), latestLocalTradeDate };
}

export function startMarketDataSync() {
  if (currentSync) return currentSync;
  stopRequested = false;
  currentSync = runSyncInWorker().finally(() => {
    currentSync = undefined;
  });
  return currentSync;
}

/**
 * 为 Agent 补齐指定已收盘交易日的数据覆盖度。与手动增量同步一致，
 * 此路径只处理 DuckDB 中缺少目标日 qfq 日K的股票。
 */
export async function ensureMarketDataCoverage(
  options: IMarketDataCoverageSyncOptions,
  onProgress?: (status: MarketDataSyncStatus) => void,
): Promise<MarketDataSyncStatus> {
  if (onProgress) {
    const unsubscribe = onMarketDataProgress(onProgress);
    try {
      return await ensureMarketDataCoverageInternal(options);
    } finally {
      unsubscribe();
    }
  }
  return ensureMarketDataCoverageInternal(options);
}

async function ensureMarketDataCoverageInternal(
  options: IMarketDataCoverageSyncOptions,
): Promise<MarketDataSyncStatus> {
  if (currentSync) await currentSync.catch(() => undefined);

  stopRequested = false;
  currentSync = runMarketDataCoverageSyncInWorker(options, updateMemory).finally(() => {
    currentSync = undefined;
  });
  return currentSync;
}

export function retryMarketDataFailures() {
  if (currentSync) return currentSync;
  stopRequested = false;
  currentSync = runRepairInWorker().finally(() => {
    currentSync = undefined;
  });
  return currentSync;
}

export function requestMarketDataSyncStop(): MarketDataSyncStatus {
  stopRequested = true;
  void requestMarketDataWorkerStop().catch((error) => console.warn('[market-data] worker stop failed', error));
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

async function runSyncInWorker(): Promise<MarketDataSyncStatus> {
  updateMemory({
    ...idleStatus(),
    state: 'checking',
    totalSymbols: 0,
    message: '正在确定目标交易日…',
  });
  try {
    const result = await runMarketDataSyncInWorker(updateMemory);
    if (stopRequested) return memoryStatus;
    if (result.backfillPending) queueHistoricalBackfill();
    return result;
  } catch (error) {
    const failed: MarketDataSyncStatus = {
      ...memoryStatus,
      state: 'failed',
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : '日K线同步失败',
    };
    updateMemory(failed);
    throw error;
  }
}

function queueHistoricalBackfill() {
  if (historicalBackfillQueued || stopRequested) return;
  historicalBackfillQueued = true;
  setTimeout(() => {
    if (currentSync || stopRequested) {
      historicalBackfillQueued = false;
      if (!stopRequested) queueHistoricalBackfill();
      return;
    }
    historicalBackfillQueued = false;
    currentSync = runHistoricalBackfill()
      .catch(() => memoryStatus)
      .finally(() => {
        currentSync = undefined;
      });
  }, 1000);
}

async function runHistoricalBackfill(): Promise<MarketDataSyncStatus> {
  updateMemory({
    ...idleStatus(),
    state: 'syncing',
    phase: 'historical',
    totalSymbols: 0,
    message: '近期日K已可用，正在后台补齐历史数据…',
  });
  try {
    const result = await runHistoricalBackfillInWorker(updateMemory);
    if (stopRequested) return memoryStatus;
    return result;
  } catch (error) {
    const failed: MarketDataSyncStatus = {
      ...memoryStatus,
      state: 'failed',
      phase: 'historical',
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : '历史日K补齐失败',
    };
    updateMemory(failed);
    throw error;
  }
}

async function runRepairInWorker(): Promise<MarketDataSyncStatus> {
  updateMemory({
    ...idleStatus(),
    state: 'syncing',
    totalSymbols: 0,
    message: '正在启动失败重试…',
  });
  try {
    const result = await retryMarketDataFailuresInWorker(updateMemory);
    if (stopRequested) return memoryStatus;
    return result;
  } catch (error) {
    const failed: MarketDataSyncStatus = {
      ...memoryStatus,
      state: 'failed',
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : '失败股票重试失败',
    };
    updateMemory(failed);
    throw error;
  }
}

function isInterruptedDailySyncJob(job: SyncJobRecord) {
  return (
    (job.status === 'running' || job.status === 'cancelled') &&
    (job.jobType === 'recent_initial' || job.jobType === 'daily_incremental')
  );
}

function isCheckpointResumable(job: SyncJobRecord) {
  const checkpointAt = job.checkpointAt ?? job.startedAt;
  if (!checkpointAt) return false;
  const checkpointTime = Date.parse(checkpointAt);
  return Number.isFinite(checkpointTime) && Date.now() - checkpointTime <= RESUME_WINDOW_MS;
}

function updateMemory(status: MarketDataSyncStatus) {
  memoryStatus = status;
  events.emit('progress', status);
}

function idleStatus(): MarketDataSyncStatus {
  return { state: 'idle', processedSymbols: 0, totalSymbols: 0, succeededSymbols: 0, failedSymbols: 0 };
}

export { getMarketDataStats };

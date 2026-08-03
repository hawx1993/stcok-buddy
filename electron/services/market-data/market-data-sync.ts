import { EventEmitter } from 'node:events';
import { resolveTradingDate } from './trade-date-resolver.js';
import {
  getLatestSyncJob,
  getLatestTradeDate,
  getMarketDataStats,
} from './market-data-store.js';
import {
  requestMarketDataWorkerStop,
  retryMarketDataFailuresInWorker,
  runMarketDataSyncInWorker,
} from './market-data-sync-worker-client.js';
import type { MarketDataSyncStatus } from './types.js';

const FORCE_SYNC_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

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
  // 手动强制同步 12h 冷却，防止频繁触发被上游限频。自动同步 force=false 不受冷却影响。
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

  if (currentSync) {
    if (!force) return currentSync;
    const chained = currentSync
      .catch(() => undefined)
      .then(() => {
        if (currentSync) return currentSync;
        stopRequested = false;
        currentSync = runSyncInWorker(true).finally(() => {
          currentSync = undefined;
        });
        return currentSync;
      });
    return chained;
  }
  stopRequested = false;
  currentSync = runSyncInWorker(force).finally(() => {
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

async function runSyncInWorker(force: boolean): Promise<MarketDataSyncStatus> {
  updateMemory({
    ...idleStatus(),
    state: 'checking',
    totalSymbols: 0,
    message: '正在确定目标交易日…',
  });
  try {
    const result = await runMarketDataSyncInWorker(force, updateMemory);
    if (stopRequested) return memoryStatus;
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

function updateMemory(status: MarketDataSyncStatus) {
  memoryStatus = status;
  events.emit('progress', status);
}

function idleStatus(): MarketDataSyncStatus {
  return { state: 'idle', processedSymbols: 0, totalSymbols: 0, succeededSymbols: 0, failedSymbols: 0 };
}

export { getMarketDataStats };

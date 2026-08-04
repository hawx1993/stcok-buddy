import { requestMarketDataSyncStop, startMarketDataSync, waitForMarketDataSync } from './market-data-sync.js';
import { disposeMarketDataSyncWorker } from './market-data-sync-worker-client.js';
import { getLatestSyncJob, initializeMarketDataStore } from './market-data-store.js';

const INITIAL_SYNC_DELAY_MS = 15_000;
const STALE_DAILY_BAR_DAYS = 31;
let initialTimer: NodeJS.Timeout | undefined;
let runtimeReady: Promise<void> | undefined;
let stopped = false;

export function ensureMarketDataRuntime() {
  runtimeReady ??= initializeMarketDataStore()
    .then(() => {
      startMarketDataScheduler();
    })
    .catch((error: unknown) => {
      runtimeReady = undefined;
      throw error;
    });
  return runtimeReady;
}

export function startMarketDataScheduler() {
  if (initialTimer) return;
  stopped = false;
  void scheduleInitialSyncIfNeeded();
}

export function stopMarketDataScheduler() {
  stopped = true;
  requestMarketDataSyncStop();
  if (initialTimer) clearTimeout(initialTimer);
  initialTimer = undefined;
}

export async function shutdownMarketDataScheduler() {
  stopMarketDataScheduler();
  await disposeMarketDataSyncWorker().catch((error) => console.warn('[market-data] worker dispose failed', error));
}

export function waitForMarketDataScheduler() {
  return waitForMarketDataSync();
}

async function scheduleInitialSyncIfNeeded() {
  if (stopped || !(await shouldAutoSyncMarketData())) return;
  initialTimer = setTimeout(() => {
    initialTimer = undefined;
    void checkAndSync();
  }, INITIAL_SYNC_DELAY_MS);
  initialTimer.unref?.();
}

async function checkAndSync() {
  if (stopped || !(await shouldAutoSyncMarketData())) return;
  try {
    await startMarketDataSync();
  } catch (error) {
    console.warn('[market-data] scheduled sync failed', error);
  }
}

async function shouldAutoSyncMarketData(now = new Date()) {
  const latestJob = await getLatestSyncJob();
  if (!latestJob?.targetTradeDate || latestJob.succeededSymbols <= 0) return true;
  const latestDate = new Date(`${latestJob.targetTradeDate}T00:00:00+08:00`);
  if (Number.isNaN(latestDate.getTime())) return true;
  return now.getTime() - latestDate.getTime() > STALE_DAILY_BAR_DAYS * 24 * 60 * 60 * 1000;
}

export const shouldAutoSyncMarketDataForTest = shouldAutoSyncMarketData;

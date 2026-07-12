import { requestMarketDataSyncStop, startMarketDataSync, waitForMarketDataSync } from './market-data-sync.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | undefined;
let stopped = false;

export function startMarketDataScheduler() {
  if (timer) return;
  stopped = false;
  void checkAndSync();
  timer = setInterval(() => void checkAndSync(), CHECK_INTERVAL_MS);
}

export function stopMarketDataScheduler() {
  stopped = true;
  requestMarketDataSyncStop();
  if (timer) clearInterval(timer);
  timer = undefined;
}

export function waitForMarketDataScheduler() {
  return waitForMarketDataSync();
}

async function checkAndSync() {
  if (stopped) return;
  try {
    await startMarketDataSync();
  } catch (error) {
    console.warn('[market-data] scheduled sync failed', error);
  }
}

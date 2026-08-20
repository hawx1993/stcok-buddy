import { requestMarketDataSyncStop, waitForMarketDataSync } from './market-data-sync.js';
import { disposeMarketDataSyncWorker } from './market-data-sync-worker-client.js';
import { initializeMarketDataStore } from '../stock-db/market-data-store.js';

let runtimeReady: Promise<void> | undefined;

export function ensureMarketDataRuntime() {
  runtimeReady ??= initializeMarketDataStore().catch((error: unknown) => {
    runtimeReady = undefined;
    throw error;
  });
  return runtimeReady;
}

export function stopMarketDataScheduler() {
  requestMarketDataSyncStop();
}

export async function shutdownMarketDataScheduler() {
  stopMarketDataScheduler();
  await disposeMarketDataSyncWorker().catch((error) => console.warn('[market-data] worker dispose failed', error));
}

export function waitForMarketDataScheduler() {
  return waitForMarketDataSync();
}

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { proxy, wrap, type Remote } from 'comlink';
import { nodeEndpoint } from '../stock/comlink-node-endpoint.js';
import { getMarketDataDatabasePath } from './market-data-store.js';
import type { MarketDataSyncStatus } from './types.js';
import type { IMarketDataSyncWorkerApi, TMarketDataProgressListener } from './market-data-sync-worker-types.js';

let worker: Worker | undefined;
let api: Remote<IMarketDataSyncWorkerApi> | undefined;

function getMarketDataSyncWorker(): Remote<IMarketDataSyncWorkerApi> {
  if (!api) {
    worker = new Worker(fileURLToPath(new URL('./market-data-sync.worker.js', import.meta.url)), {
      env: {
        ...process.env,
        STOCKSENSE_MARKET_DB_PATH: getMarketDataDatabasePath(),
      },
    });
    worker.once('exit', () => {
      worker = undefined;
      api = undefined;
    });
    api = wrap<IMarketDataSyncWorkerApi>(nodeEndpoint(worker));
  }
  return api;
}

export function runMarketDataSyncInWorker(
  force: boolean,
  onProgress: TMarketDataProgressListener,
): Promise<MarketDataSyncStatus> {
  return getMarketDataSyncWorker().runSync(force, proxy(onProgress));
}

export function retryMarketDataFailuresInWorker(
  onProgress: TMarketDataProgressListener,
): Promise<MarketDataSyncStatus> {
  return getMarketDataSyncWorker().runRepair(proxy(onProgress));
}

export function runHistoricalBackfillInWorker(
  onProgress: TMarketDataProgressListener,
): Promise<MarketDataSyncStatus> {
  return getMarketDataSyncWorker().runHistoricalBackfill(proxy(onProgress));
}

export async function requestMarketDataWorkerStop(): Promise<void> {
  if (!api) return;
  await api.requestStop();
}

export async function disposeMarketDataSyncWorker(): Promise<void> {
  const currentWorker = worker;
  api = undefined;
  worker = undefined;
  if (!currentWorker) return;
  await currentWorker.terminate().then(() => undefined);
}

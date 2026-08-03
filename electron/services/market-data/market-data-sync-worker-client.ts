import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { proxy, wrap, type Remote } from 'comlink';
import { nodeEndpoint } from '../stock/comlink-node-endpoint.js';
import type { MarketDataSyncStatus } from './types.js';
import type { IMarketDataSyncWorkerApi, TMarketDataProgressListener } from './market-data-sync-worker-types.js';

let worker: Worker | undefined;
let api: Remote<IMarketDataSyncWorkerApi> | undefined;

function getMarketDataSyncWorker(): Remote<IMarketDataSyncWorkerApi> {
  if (!api) {
    worker = new Worker(fileURLToPath(new URL('./market-data-sync.worker.js', import.meta.url)));
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
  return getMarketDataSyncWorker().runSync({ force, onProgress: proxy(onProgress) });
}

export function retryMarketDataFailuresInWorker(
  onProgress: TMarketDataProgressListener,
): Promise<MarketDataSyncStatus> {
  return getMarketDataSyncWorker().runRepair(proxy(onProgress));
}

export async function requestMarketDataWorkerStop(): Promise<void> {
  if (!api) return;
  await api.requestStop();
}

export function disposeMarketDataSyncWorker(): void {
  api = undefined;
  worker?.terminate();
  worker = undefined;
}

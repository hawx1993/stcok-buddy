import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { proxy, wrap, type Remote } from 'comlink';
import { nodeEndpoint } from '../stock/comlink-node-endpoint.js';
import { getMarketDataDatabasePath } from '../stock-db/market-data-store.js';
import type {
  IHydrateAllMarketChipsOptions,
  IMarketDataHydrationStatus,
  IMarketDataHydrationWorkerApi,
  TMarketDataHydrationProgressListener,
} from './market-data-hydration-worker-types.js';

let worker: Worker | undefined;
let api: Remote<IMarketDataHydrationWorkerApi> | undefined;

function getMarketDataHydrationWorker(): Remote<IMarketDataHydrationWorkerApi> {
  if (!api) {
    worker = new Worker(fileURLToPath(new URL('./market-data-hydration.worker', import.meta.url)), {
      env: {
        ...process.env,
        STOCKSENSE_MARKET_DB_PATH: getMarketDataDatabasePath(),
      },
    });
    worker.once('exit', () => {
      worker = undefined;
      api = undefined;
    });
    api = wrap<IMarketDataHydrationWorkerApi>(nodeEndpoint(worker));
  }
  return api;
}

export function hydrateAllMarketSnapshotsInWorker(
  onProgress: TMarketDataHydrationProgressListener,
): Promise<IMarketDataHydrationStatus> {
  return getMarketDataHydrationWorker().hydrateAllMarketSnapshots(proxy(onProgress));
}

export function hydrateAllSecuritiesInWorker(
  onProgress: TMarketDataHydrationProgressListener,
): Promise<IMarketDataHydrationStatus> {
  return getMarketDataHydrationWorker().hydrateAllSecurities(proxy(onProgress));
}

export function hydrateAllMarketChipsInWorker(
  options: IHydrateAllMarketChipsOptions,
  onProgress: TMarketDataHydrationProgressListener,
): Promise<IMarketDataHydrationStatus> {
  return getMarketDataHydrationWorker().hydrateAllMarketChips(options, proxy(onProgress));
}

export async function disposeMarketDataHydrationWorker(): Promise<void> {
  const currentWorker = worker;
  api = undefined;
  worker = undefined;
  if (!currentWorker) return;
  await currentWorker.terminate().then(() => undefined);
}

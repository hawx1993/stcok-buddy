import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { wrap, type Remote } from 'comlink';
import { nodeEndpoint } from './comlink-node-endpoint.js';
import type { IChipDistributionResult, KlinePoint, TChipDistributionSource } from '../../../src/shared/types.js';
import type { IChipDistributionWorkerApi } from './chip-distribution-worker-types.js';

let worker: Worker | undefined;
let api: Remote<IChipDistributionWorkerApi> | undefined;

function getChipDistributionWorker(): Remote<IChipDistributionWorkerApi> {
  if (!api) {
    worker = new Worker(fileURLToPath(new URL('./chip-distribution.worker.js', import.meta.url)));
    worker.once('exit', () => {
      worker = undefined;
      api = undefined;
    });
    api = wrap<IChipDistributionWorkerApi>(nodeEndpoint(worker));
  }
  return api;
}

export function loadStockSdkChipDistributionInWorker(symbol: string): Promise<IChipDistributionResult> {
  return getChipDistributionWorker().loadStockSdkChipDistribution(symbol);
}

export function calculateChipDistributionInWorker(
  klines: KlinePoint[],
  source: TChipDistributionSource,
  warnings?: string[],
): Promise<IChipDistributionResult> {
  return getChipDistributionWorker().calculateChipDistribution({ klines, source, warnings });
}

export function disposeChipDistributionWorker(): void {
  api = undefined;
  worker?.terminate();
  worker = undefined;
}

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { wrap, type Remote } from 'comlink';
import { nodeEndpoint } from './comlink-node-endpoint.js';
import type {
  IChipDistributionResult,
  KlinePoint,
  TChipDistributionPeriod,
  TChipDistributionSource,
} from '../../../src/shared/types.js';
import type { IChipDistributionWorkerApi } from './chip-distribution-worker-types.js';

let worker: Worker | undefined;
let api: Remote<IChipDistributionWorkerApi> | undefined;

function getChipDistributionWorker(): Remote<IChipDistributionWorkerApi> {
  if (!api) {
    worker = new Worker(fileURLToPath(new URL('./chip-distribution.worker', import.meta.url)));
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
  period: TChipDistributionPeriod = '1d',
): Promise<IChipDistributionResult> {
  return getChipDistributionWorker().calculateChipDistribution({ klines, source, period, warnings });
}

export async function disposeChipDistributionWorker(): Promise<void> {
  const currentWorker = worker;
  api = undefined;
  worker = undefined;
  if (currentWorker) await currentWorker.terminate();
}

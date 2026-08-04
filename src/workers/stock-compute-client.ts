import { wrap, type Remote } from 'comlink';
import type { IStockComputeApi } from './stock-compute-types';

let worker: Worker | undefined;
let api: Remote<IStockComputeApi> | undefined;

export function getStockComputeWorker(): Remote<IStockComputeApi> {
  if (!api) {
    worker = new Worker(new URL('./stock-compute.worker.ts', import.meta.url), { type: 'module' });
    api = wrap<IStockComputeApi>(worker);
  }
  return api;
}

export function disposeStockComputeWorker() {
  worker?.terminate();
  worker = undefined;
  api = undefined;
}

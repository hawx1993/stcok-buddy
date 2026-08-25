import { parentPort } from 'node:worker_threads';
import { expose } from 'comlink';
import { nodeEndpoint } from '../quotes/comlink-node-endpoint.js';
import StockSDK from 'stock-sdk';
import { calculateChipDistribution } from './chip-distribution.js';
import { chipRowsToResult } from './chip-distribution.js';
import type { IChipDistributionWorkerApi, ICalculateChipDistributionInput } from './chip-distribution-worker-types.js';

if (!parentPort) throw new Error('chip distribution worker requires parentPort');

const sdk = new StockSDK({ timeout: 12_000, retry: { maxRetries: 1 } });

const api: IChipDistributionWorkerApi = {
  async loadStockSdkChipDistribution(symbol: string) {
    const rows = await sdk.chips.cn(symbol, { days: 360, range: 120, includeHistogram: 'all' });
    return chipRowsToResult(rows, 'stock-sdk', undefined, '1d');
  },

  async calculateChipDistribution({ klines, source, period, warnings }: ICalculateChipDistributionInput) {
    return calculateChipDistribution(klines, source, warnings, period);
  },
};

expose(api, nodeEndpoint(parentPort));

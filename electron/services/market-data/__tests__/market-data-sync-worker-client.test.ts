import { afterEach, describe, expect, it, vi } from 'vitest';

const comlinkMocks = vi.hoisted(() => {
  const status = {
    state: 'completed' as const,
    processedSymbols: 1,
    totalSymbols: 1,
    succeededSymbols: 1,
    failedSymbols: 0,
  };
  const api = {
    runSync: vi.fn(() => Promise.resolve(status)),
    runRepair: vi.fn(() => Promise.resolve(status)),
    runHistoricalBackfill: vi.fn(() => Promise.resolve(status)),
    requestStop: vi.fn(() => Promise.resolve()),
  };
  return {
    api,
    proxy: vi.fn(<T>(value: T) => value),
    wrap: vi.fn(() => api),
  };
});

const workerMocks = vi.hoisted(() => {
  const instances: MockWorker[] = [];

  class MockWorker {
    once = vi.fn();
    terminate = vi.fn(() => Promise.resolve(0));

    constructor(
      public readonly filename: string,
      public readonly options?: { env?: NodeJS.ProcessEnv },
    ) {
      instances.push(this);
    }
  }

  return { MockWorker, instances };
});

vi.mock('node:worker_threads', () => ({
  Worker: workerMocks.MockWorker,
}));

vi.mock('comlink', () => ({
  proxy: comlinkMocks.proxy,
  wrap: comlinkMocks.wrap,
}));

vi.mock('../../stock/comlink-node-endpoint.js', () => ({
  nodeEndpoint: vi.fn(() => ({})),
}));

vi.mock('../market-data-store.js', () => ({
  getMarketDataDatabasePath: () => '/tmp/stocksense-market-worker-test.duckdb',
}));

import {
  disposeMarketDataSyncWorker,
  runHistoricalBackfillInWorker,
  runMarketDataSyncInWorker,
} from '../market-data-sync-worker-client.js';

describe('market data sync worker client', () => {
  afterEach(async () => {
    await disposeMarketDataSyncWorker();
    workerMocks.instances.length = 0;
    vi.clearAllMocks();
  });

  it('passes the progress callback and market database path to the worker', async () => {
    const listener = vi.fn();

    await runMarketDataSyncInWorker(true, listener);

    expect(workerMocks.instances[0]?.options?.env?.STOCKSENSE_MARKET_DB_PATH).toBe('/tmp/stocksense-market-worker-test.duckdb');
    expect(comlinkMocks.proxy).toHaveBeenCalledWith(listener);
    expect(comlinkMocks.api.runSync).toHaveBeenCalledWith(true, listener);
    expect(comlinkMocks.api.runSync).not.toHaveBeenCalledWith(
      expect.objectContaining({ force: true, onProgress: listener }),
    );
  });

  it('passes the historical backfill callback as a top-level Comlink proxy argument', async () => {
    const listener = vi.fn();

    await runHistoricalBackfillInWorker(listener);

    expect(comlinkMocks.proxy).toHaveBeenCalledWith(listener);
    expect(comlinkMocks.api.runHistoricalBackfill).toHaveBeenCalledWith(listener);
  });
});

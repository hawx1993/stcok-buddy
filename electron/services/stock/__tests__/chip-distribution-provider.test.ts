import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChipDistributionResult } from '../../../../src/shared/types.js';

const storeMocks = vi.hoisted(() => ({
  getStockChipCacheRecord: vi.fn(),
  upsertStockChip: vi.fn(),
}));

const workerMocks = vi.hoisted(() => ({
  calculateChipDistributionInWorker: vi.fn(),
  loadStockSdkChipDistributionInWorker: vi.fn(),
}));

const aStockDataMocks = vi.hoisted(() => ({
  runAStockDataFn: vi.fn(),
}));

vi.mock('../../market-data/market-data-store.js', () => storeMocks);
vi.mock('../chip-distribution-worker-client.js', () => workerMocks);
vi.mock('../a-stock-data-runner.js', () => aStockDataMocks);
vi.mock('../symbols.js', () => ({
  normalizeASymbol: (symbol: string) => symbol,
}));

function chipResult(): IChipDistributionResult {
  return {
    latest: {
      date: '2026-08-17',
      concentration70: 0.08,
      concentration90: 0.13,
      profitRatio: 0.6,
      points: [{ price: 10, weight: 1 }],
    },
    distributions: [],
    trend: [],
    source: 'stock-sdk',
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storeMocks.getStockChipCacheRecord.mockResolvedValue(undefined);
  storeMocks.upsertStockChip.mockResolvedValue(undefined);
  workerMocks.loadStockSdkChipDistributionInWorker.mockResolvedValue(chipResult());
});

describe('chip distribution provider persistence', () => {
  it('does not resolve a remote chip result before the DuckDB upsert completes', async () => {
    let resolveWrite: (() => void) | undefined;
    storeMocks.upsertStockChip.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));
    const { getChipDistribution } = await import('../chip-distribution-provider.js');
    let settled = false;

    const resultPromise = getChipDistribution('600519').then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(storeMocks.upsertStockChip).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    resolveWrite?.();

    await expect(resultPromise).resolves.toEqual(chipResult());
    expect(storeMocks.upsertStockChip).toHaveBeenCalledWith('600519', chipResult());
  });

  it('reuses the persisted DuckDB record after the provider module is reloaded', async () => {
    let persistedRecord: { symbol: string; data: IChipDistributionResult; fetchedAt: string } | undefined;
    storeMocks.getStockChipCacheRecord.mockImplementation(async () => persistedRecord);
    storeMocks.upsertStockChip.mockImplementation(async (symbol: string, data: IChipDistributionResult) => {
      persistedRecord = { symbol, data, fetchedAt: new Date().toISOString() };
    });

    const firstProvider = await import('../chip-distribution-provider.js');
    await firstProvider.getChipDistribution('600519');
    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const reloadedProvider = await import('../chip-distribution-provider.js');
    await expect(reloadedProvider.getChipDistribution('600519')).resolves.toEqual(chipResult());

    expect(storeMocks.getStockChipCacheRecord).toHaveBeenCalledTimes(2);
    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(1);
    expect(storeMocks.upsertStockChip).toHaveBeenCalledTimes(1);
  });

  it('surfaces a DuckDB write failure and retries instead of keeping a memory-only result', async () => {
    storeMocks.upsertStockChip
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const { getChipDistribution } = await import('../chip-distribution-provider.js');

    await expect(getChipDistribution('600519')).rejects.toThrow('DuckDB 筹码缓存写入失败（600519）：disk full');
    await expect(getChipDistribution('600519')).resolves.toEqual(chipResult());

    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(2);
    expect(storeMocks.upsertStockChip).toHaveBeenCalledTimes(2);
  });
});

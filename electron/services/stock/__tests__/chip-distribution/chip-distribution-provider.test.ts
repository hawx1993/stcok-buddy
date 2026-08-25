import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChipDistributionResult, TChipDistributionPeriod } from '../../../../../src/shared/types.js';

interface IPersistedChipDistributionResult extends IChipDistributionResult {
  chipSnapshotVersion: number;
}

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

vi.mock('../../../stock-db/market-data-store', () => storeMocks);
vi.mock('../../chip-distribution/chip-distribution-worker-client', () => workerMocks);
vi.mock('../../quotes/a-stock-data-runner', () => aStockDataMocks);
vi.mock('../../stock-detail/symbols', () => ({
  normalizeASymbol: (symbol: string) => symbol,
}));

function chipResult(period: TChipDistributionPeriod = '1d'): IChipDistributionResult {
  const earlier = {
    date: '2026-08-16',
    period,
    concentration70: 0.05,
    concentration90: 0.1,
    profitRatio: 0.4,
    avgCost: 9.8,
    cost70: '9.50-10.10',
    cost90: '9.20-10.40',
    points: [{ price: 9.8, weight: 1 }],
  };
  const latest = {
    date: '2026-08-17',
    period,
    concentration70: 0.08,
    concentration90: 0.13,
    profitRatio: 0.6,
    avgCost: 10.2,
    cost70: '9.80-10.60',
    cost90: '9.50-10.90',
    points: [{ price: 10.2, weight: 1 }],
  };
  return {
    period,
    latest,
    distributions: [earlier, latest],
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
  it('resolves a remote chip result without waiting for the DuckDB upsert', async () => {
    let resolveWrite: (() => void) | undefined;
    storeMocks.upsertStockChip.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const { getChipDistribution } = await import('../../chip-distribution/chip-distribution-provider.js');

    const resultPromise = getChipDistribution('600519');

    await vi.waitFor(() => expect(storeMocks.upsertStockChip).toHaveBeenCalledTimes(1));
    await expect(resultPromise).resolves.toEqual(chipResult());
    expect(storeMocks.upsertStockChip).toHaveBeenCalledWith('600519', chipResult(), '1d');
    resolveWrite?.();
  });

  it('reuses the persisted DuckDB record after the provider module is reloaded', async () => {
    let persistedRecord:
      | { symbol: string; period: TChipDistributionPeriod; data: IPersistedChipDistributionResult; fetchedAt: string }
      | undefined;
    storeMocks.getStockChipCacheRecord.mockImplementation(async () => persistedRecord);
    storeMocks.upsertStockChip.mockImplementation(
      async (symbol: string, data: IChipDistributionResult, period: TChipDistributionPeriod) => {
        persistedRecord = {
          symbol,
          period,
          data: { ...data, chipSnapshotVersion: 2 },
          fetchedAt: new Date().toISOString(),
        };
      },
    );

    const firstProvider = await import('../../chip-distribution/chip-distribution-provider.js');
    await firstProvider.getChipDistribution('600519');
    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(persistedRecord).toBeDefined());

    vi.resetModules();
    const reloadedProvider = await import('../../chip-distribution/chip-distribution-provider.js');
    await expect(reloadedProvider.getChipDistribution('600519')).resolves.toEqual(chipResult());

    expect(storeMocks.getStockChipCacheRecord).toHaveBeenCalledTimes(2);
    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(1);
    expect(storeMocks.upsertStockChip).toHaveBeenCalledTimes(1);
  });

  it('refreshes a fresh legacy cache that lacks historical snapshots', async () => {
    storeMocks.getStockChipCacheRecord.mockResolvedValueOnce({
      symbol: '600519',
      period: '1d',
      data: chipResult(),
      fetchedAt: new Date().toISOString(),
    });
    const { getChipDistribution } = await import('../../chip-distribution/chip-distribution-provider.js');

    await expect(getChipDistribution('600519')).resolves.toEqual(chipResult());

    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(1);
    expect(storeMocks.upsertStockChip).toHaveBeenCalledWith('600519', chipResult(), '1d');
  });

  it('keeps the real chip result visible when DuckDB cache write fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    storeMocks.upsertStockChip.mockRejectedValueOnce(new Error('disk full'));
    const { getChipDistribution } = await import('../../chip-distribution/chip-distribution-provider.js');

    await expect(getChipDistribution('600519')).resolves.toEqual(chipResult());

    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledTimes(1);
    expect(storeMocks.upsertStockChip).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[chip-distribution] DuckDB 日K筹码缓存写入失败（600519）：disk full',
      ),
    );
    warnSpy.mockRestore();
  });

  it.each([
    ['15m', '15分钟'],
    ['1h', '1小时'],
    ['1w', '周K'],
    ['1mo', '月K'],
  ] as const)('uses the daily chip data path for %s', async (period, label) => {
    const { getChipDistribution } = await import('../../chip-distribution/chip-distribution-provider.js');

    await expect(getChipDistribution('600519', period)).resolves.toEqual({
      ...chipResult(period),
      warnings: [`数据说明：${label}视图展示stock-sdk日K筹码分布`],
    });

    expect(storeMocks.getStockChipCacheRecord).toHaveBeenCalledWith('600519', period);
    expect(storeMocks.upsertStockChip).toHaveBeenCalledWith(
      '600519',
      {
        ...chipResult(period),
        warnings: [`数据说明：${label}视图展示stock-sdk日K筹码分布`],
      },
      period,
    );
    expect(workerMocks.loadStockSdkChipDistributionInWorker).toHaveBeenCalledWith('600519');
    expect(workerMocks.calculateChipDistributionInWorker).not.toHaveBeenCalled();
  });

  it('uses the daily a-stock-data fallback for non-daily views when stock-sdk chips fail', async () => {
    workerMocks.loadStockSdkChipDistributionInWorker.mockRejectedValueOnce(new Error('daily chip endpoint unavailable'));
    aStockDataMocks.runAStockDataFn.mockResolvedValueOnce({
      keys: ['time', 'open', 'high', 'low', 'close', 'volume', 'turnoverratio'],
      rows: ['2026-08-17,10,11,9,10.5,1000,1.2'],
    });
    workerMocks.calculateChipDistributionInWorker.mockResolvedValueOnce({
      ...chipResult(),
      source: 'a-stock-data',
    });
    const { getChipDistribution } = await import('../../chip-distribution/chip-distribution-provider.js');

    await expect(getChipDistribution('600519', '1h')).resolves.toEqual({
      ...chipResult('1h'),
      source: 'a-stock-data',
      warnings: [
        'stock-sdk 筹码数据获取失败：daily chip endpoint unavailable',
        '数据说明：1小时视图展示a-stock-data 百度日K筹码分布',
      ],
    });

    expect(aStockDataMocks.runAStockDataFn).toHaveBeenCalledWith('baidu_kline_with_ma', { code: '600519' });
    expect(workerMocks.calculateChipDistributionInWorker).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          time: '2026-08-17',
          turnoverRate: 1.2,
        }),
      ],
      'a-stock-data',
      ['stock-sdk 筹码数据获取失败：daily chip endpoint unavailable'],
      '1d',
    );
  });

  it('rejects unsupported chip distribution periods', async () => {
    const { getChipDistribution } = await import('../../chip-distribution/chip-distribution-provider.js');

    await expect(getChipDistribution('600519', 'timeline')).rejects.toThrow('不支持的筹码分布周期：timeline');
  });
});

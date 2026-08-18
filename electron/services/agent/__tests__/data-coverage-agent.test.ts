import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  countDailyBarsForDate: vi.fn(),
  countStockChips: vi.fn(),
  countStockSnapshots: vi.fn(),
  getLatestSyncJob: vi.fn(),
  getLatestTradeDate: vi.fn(),
  getMarketDataStats: vi.fn(),
  listSecurities: vi.fn(),
  listStockChips: vi.fn(),
  upsertSecurities: vi.fn(),
  upsertStockSnapshots: vi.fn(),
}));

const snapshotMocks = vi.hoisted(() => ({
  fetchStockSdkAllMarketSnapshotQuotes: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  listRemoteSecurities: vi.fn(),
}));

const syncMocks = vi.hoisted(() => ({
  determineTargetTradeDate: vi.fn(),
  ensureMarketDataCoverage: vi.fn(),
}));

const chipMocks = vi.hoisted(() => ({
  getChipDistribution: vi.fn(),
}));

vi.mock('../../market-data/market-data-store', () => storeMocks);
vi.mock('../../market-data/market-snapshot-provider', () => snapshotMocks);
vi.mock('../../market-data/providers', () => providerMocks);
vi.mock('../../market-data/market-data-sync', () => syncMocks);
vi.mock('../../stock/chip-distribution-provider', () => chipMocks);

import { runDataCoverageAgent } from '../data-coverage-agent.js';
import type { IAgentContext } from '../orchestrator-types.js';

function createContext(): IAgentContext {
  return {
    query: '筛选最近已收盘交易日的股票',
    intent: 'condition-screener',
    urls: [],
    evidence: [],
    toolCalls: [],
    findings: [],
  };
}

function marketDataStats(securityCount = 5000) {
  return {
    securityCount,
    dailyBarCount: securityCount,
    latestTradeDate: '2026-08-17',
    databaseBytes: 1024,
    failedSymbols: 0,
  };
}

function completedSyncStatus() {
  return {
    state: 'completed' as const,
    processedSymbols: 0,
    totalSymbols: 0,
    succeededSymbols: 0,
    failedSymbols: 0,
    targetTradeDate: '2026-08-17',
    latestLocalTradeDate: '2026-08-17',
    message: 'DuckDB 已覆盖 2026-08-17 日K（5000/5000）',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.getMarketDataStats.mockResolvedValue(marketDataStats());
  storeMocks.countDailyBarsForDate.mockResolvedValue(5000);
  storeMocks.countStockSnapshots.mockResolvedValue(5000);
  storeMocks.countStockChips.mockResolvedValue(5000);
  storeMocks.getLatestTradeDate.mockResolvedValue('2026-08-17');
  storeMocks.getLatestSyncJob.mockResolvedValue(undefined);
  storeMocks.listSecurities.mockResolvedValue([]);
  storeMocks.listStockChips.mockResolvedValue([]);
  storeMocks.upsertSecurities.mockResolvedValue(undefined);
  storeMocks.upsertStockSnapshots.mockResolvedValue(undefined);
  snapshotMocks.fetchStockSdkAllMarketSnapshotQuotes.mockResolvedValue({ quotes: [], warnings: [] });
  providerMocks.listRemoteSecurities.mockResolvedValue([]);
  syncMocks.determineTargetTradeDate.mockResolvedValue('2026-08-17');
  syncMocks.ensureMarketDataCoverage.mockResolvedValue(completedSyncStatus());
  chipMocks.getChipDistribution.mockResolvedValue(undefined);
});

describe('data coverage agent', () => {
  it('reuses same-day DuckDB coverage without remote bootstrap or daily-K synchronization', async () => {
    const first = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });
    const second = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(syncMocks.ensureMarketDataCoverage).not.toHaveBeenCalled();
    expect(snapshotMocks.fetchStockSdkAllMarketSnapshotQuotes).not.toHaveBeenCalled();
    expect(providerMocks.listRemoteSecurities).not.toHaveBeenCalled();
    expect(storeMocks.countDailyBarsForDate).toHaveBeenCalledWith('2026-08-17');
  });

  it('requests only target-date coverage repair when the DuckDB target date is behind and not yet attempted', async () => {
    storeMocks.countDailyBarsForDate.mockResolvedValue(4800);
    storeMocks.getLatestTradeDate.mockResolvedValue('2026-08-14');

    const result = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });

    expect(result.ok).toBe(false);
    expect(syncMocks.ensureMarketDataCoverage).toHaveBeenCalledTimes(1);
    expect(syncMocks.ensureMarketDataCoverage).toHaveBeenCalledWith(
      { targetTradeDate: '2026-08-17', minCoverage: 5000 },
      expect.any(Function),
    );
    expect(snapshotMocks.fetchStockSdkAllMarketSnapshotQuotes).not.toHaveBeenCalled();
    expect(providerMocks.listRemoteSecurities).not.toHaveBeenCalled();
  });

  it('skips the repeated daily-K sync when the target date was already synced, even if symbol coverage is low', async () => {
    storeMocks.countDailyBarsForDate.mockResolvedValue(1749);
    storeMocks.getLatestTradeDate.mockResolvedValue('2026-08-17');
    storeMocks.getLatestSyncJob.mockResolvedValue({
      id: 'job-1',
      jobType: 'daily_incremental',
      targetTradeDate: '2026-08-17',
      status: 'partial',
      processedSymbols: 4328,
      totalSymbols: 4328,
      succeededSymbols: 3000,
      failedSymbols: 1328,
    });

    const result = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });

    expect(syncMocks.ensureMarketDataCoverage).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('skips the daily-K sync when the target date is already covered locally, even if below minCoverage', async () => {
    storeMocks.countDailyBarsForDate.mockResolvedValue(1749);
    storeMocks.getLatestTradeDate.mockResolvedValue('2026-08-17');

    const result = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });

    expect(syncMocks.ensureMarketDataCoverage).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('condition screener skips the daily-K coverage check entirely (requireDailyBars=false)', async () => {
    storeMocks.countDailyBarsForDate.mockResolvedValue(0);
    storeMocks.getLatestTradeDate.mockResolvedValue('2026-08-14');

    const result = await runDataCoverageAgent(createContext(), { minCoverage: 5000, requireDailyBars: false });

    expect(syncMocks.ensureMarketDataCoverage).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('condition screener does not hydrate whole-market chips when local chip coverage is below 5000', async () => {
    storeMocks.countStockChips.mockResolvedValue(1152);
    const context = createContext();
    const emitEvent = vi.fn();
    context.emitEvent = emitEvent;

    const result = await runDataCoverageAgent(context, {
      minCoverage: 5000,
      needsChips: false,
      requireDailyBars: false,
    });

    expect(result.ok).toBe(true);
    expect(result.after.chips).toBe(1152);
    expect(chipMocks.getChipDistribution).not.toHaveBeenCalled();
    expect(storeMocks.listStockChips).not.toHaveBeenCalled();
    const progressMessages = emitEvent.mock.calls.map(([event]) => event.message).join('；');
    expect(progressMessages).not.toContain('正在补齐缺失筹码');
  });

  it('uses the full-market snapshot to persist securities before falling back to a separate security request', async () => {
    storeMocks.getMarketDataStats.mockResolvedValue(marketDataStats(2));
    storeMocks.countDailyBarsForDate.mockResolvedValue(2);
    storeMocks.countStockChips.mockResolvedValue(2);
    storeMocks.countStockSnapshots.mockResolvedValueOnce(0).mockResolvedValue(2);
    snapshotMocks.fetchStockSdkAllMarketSnapshotQuotes.mockResolvedValue({
      quotes: [
        {
          code: '600519',
          name: '贵州茅台',
          exchange: 'SH',
          price: 1500,
          change: 10,
          changePercent: 0.67,
          open: 1490,
          high: 1510,
          low: 1480,
          prevClose: 1490,
          volume: 1000,
          amount: 100_000,
          turnoverRate: 1.2,
          pe: 20,
          pb: 8,
          totalMarketCap: 18_000,
          circulatingMarketCap: 18_000,
          amplitude: 2,
        },
      ],
      warnings: [],
    });

    const result = await runDataCoverageAgent(createContext(), { minCoverage: 2 });

    expect(result.ok).toBe(true);
    expect(storeMocks.upsertStockSnapshots).toHaveBeenCalledTimes(1);
    expect(storeMocks.upsertSecurities).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: '600519',
        name: '贵州茅台',
        exchange: 'SH',
        securityType: 'stock',
        status: 'listed',
      }),
    ]);
    expect(providerMocks.listRemoteSecurities).not.toHaveBeenCalled();
  });
});

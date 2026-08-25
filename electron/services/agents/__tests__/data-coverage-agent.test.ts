import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  countDailyBarsForDate: vi.fn(),
  countFreshListedStockChips: vi.fn(),
  countStockSnapshots: vi.fn(),
  getLatestSyncJob: vi.fn(),
  getLatestTradeDate: vi.fn(),
  getMarketDataStats: vi.fn(),
}));

const hydrationMocks = vi.hoisted(() => ({
  hydrateAllMarketChipsInWorker: vi.fn(),
  hydrateAllMarketSnapshotsInWorker: vi.fn(),
  hydrateAllSecuritiesInWorker: vi.fn(),
}));

const syncMocks = vi.hoisted(() => ({
  determineTargetTradeDate: vi.fn(),
  ensureMarketDataCoverage: vi.fn(),
}));

const chipMocks = vi.hoisted(() => ({
  getChipDistribution: vi.fn(),
}));

vi.mock('../../stock-db/market-data-store', () => storeMocks);
vi.mock('../../market-data/market-data-hydration-worker-client', () => hydrationMocks);
vi.mock('../../market-data/market-data-sync', () => syncMocks);
vi.mock('../../stock/chip-distribution/chip-distribution-provider', () => chipMocks);

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

function completedHydrationStatus(stage: 'snapshots' | 'securities' | 'chips', hydrated: number) {
  return {
    state: 'completed' as const,
    stage,
    processed: hydrated,
    total: hydrated,
    succeeded: hydrated,
    failed: 0,
    hydrated,
    warnings: [],
    message: `hydrated ${hydrated}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.getMarketDataStats.mockResolvedValue(marketDataStats());
  storeMocks.countDailyBarsForDate.mockResolvedValue(5000);
  storeMocks.countStockSnapshots.mockResolvedValue(5000);
  storeMocks.countFreshListedStockChips.mockResolvedValue(5000);
  storeMocks.getLatestTradeDate.mockResolvedValue('2026-08-17');
  storeMocks.getLatestSyncJob.mockResolvedValue(undefined);
  hydrationMocks.hydrateAllMarketSnapshotsInWorker.mockResolvedValue(completedHydrationStatus('snapshots', 5000));
  hydrationMocks.hydrateAllSecuritiesInWorker.mockResolvedValue(completedHydrationStatus('securities', 5000));
  hydrationMocks.hydrateAllMarketChipsInWorker.mockResolvedValue(completedHydrationStatus('chips', 5000));
  syncMocks.determineTargetTradeDate.mockResolvedValue('2026-08-17');
  syncMocks.ensureMarketDataCoverage.mockResolvedValue(completedSyncStatus());
  chipMocks.getChipDistribution.mockResolvedValue({ warnings: [] });
});

describe('data coverage agent', () => {
  it('reuses same-day DuckDB coverage without remote bootstrap or daily-K synchronization', async () => {
    const first = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });
    const second = await runDataCoverageAgent(createContext(), { minCoverage: 5000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(syncMocks.ensureMarketDataCoverage).not.toHaveBeenCalled();
    expect(hydrationMocks.hydrateAllMarketSnapshotsInWorker).not.toHaveBeenCalled();
    expect(hydrationMocks.hydrateAllSecuritiesInWorker).not.toHaveBeenCalled();
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
    expect(hydrationMocks.hydrateAllMarketSnapshotsInWorker).not.toHaveBeenCalled();
    expect(hydrationMocks.hydrateAllSecuritiesInWorker).not.toHaveBeenCalled();
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

  it('does not hydrate whole-market chips when chip coverage mode is none and local chip coverage is below 5000', async () => {
    storeMocks.countFreshListedStockChips.mockResolvedValue(1152);
    const context = createContext();
    const emitEvent = vi.fn();
    context.emitEvent = emitEvent;

    const result = await runDataCoverageAgent(context, {
      minCoverage: 5000,
      chipCoverageMode: 'none',
      requireDailyBars: false,
    });

    expect(result.ok).toBe(true);
    expect(result.after.chips).toBe(1152);
    expect(chipMocks.getChipDistribution).not.toHaveBeenCalled();
    expect(hydrationMocks.hydrateAllMarketChipsInWorker).not.toHaveBeenCalled();
    const progressMessages = emitEvent.mock.calls.map(([event]) => event.message).join('；');
    expect(progressMessages).not.toContain('A 股全市场目标');
  });

  it('hydrates only the requested symbol in symbol chip coverage mode', async () => {
    storeMocks.countFreshListedStockChips.mockResolvedValue(1152);

    const result = await runDataCoverageAgent(createContext(), {
      minCoverage: 5000,
      chipCoverageMode: 'symbol',
      chipSymbol: '600519',
      requireDailyBars: false,
    });

    expect(result.ok).toBe(true);
    expect(result.chipCoverageMode).toBe('symbol');
    expect(chipMocks.getChipDistribution).toHaveBeenCalledWith('600519');
    expect(hydrationMocks.hydrateAllMarketChipsInWorker).not.toHaveBeenCalled();
  });

  it('hydrates A-share whole-market chips in worker when market chip coverage is below the listed-stock target', async () => {
    let freshChipCount = 1152;
    storeMocks.countFreshListedStockChips.mockImplementation(async () => freshChipCount);
    hydrationMocks.hydrateAllMarketChipsInWorker.mockImplementation(async () => {
      freshChipCount = 5000;
      return completedHydrationStatus('chips', 3848);
    });

    const result = await runDataCoverageAgent(createContext(), {
      minCoverage: 5000,
      chipCoverageMode: 'market',
      requireDailyBars: false,
    });

    expect(result.ok).toBe(true);
    expect(result.chipCoverageMode).toBe('market');
    expect(hydrationMocks.hydrateAllMarketChipsInWorker).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 120_000 }),
      expect.any(Function),
    );
    expect(chipMocks.getChipDistribution).not.toHaveBeenCalled();
  });

  it('uses the hydration worker for full-market snapshots before falling back to a separate security worker request', async () => {
    storeMocks.getMarketDataStats.mockResolvedValue(marketDataStats(2));
    storeMocks.countDailyBarsForDate.mockResolvedValue(2);
    storeMocks.countFreshListedStockChips.mockResolvedValue(2);
    storeMocks.countStockSnapshots.mockResolvedValueOnce(0).mockResolvedValue(2);

    const result = await runDataCoverageAgent(createContext(), { minCoverage: 2 });

    expect(result.ok).toBe(true);
    expect(hydrationMocks.hydrateAllMarketSnapshotsInWorker).toHaveBeenCalledTimes(1);
    expect(hydrationMocks.hydrateAllSecuritiesInWorker).not.toHaveBeenCalled();
  });
});

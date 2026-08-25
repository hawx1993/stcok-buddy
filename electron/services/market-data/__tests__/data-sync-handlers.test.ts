import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(() => []),
  ensureMarketDataRuntime: vi.fn(() => Promise.resolve()),
  startMarketDataSync: vi.fn(() => Promise.resolve()),
  listSecurities: vi.fn(),
  ensureSurgeHistoryCapture: vi.fn(),
  isSurgeHistorySchedulerRunning: vi.fn(() => true),
  getSurgeHistoryFreshness: vi.fn(),
  listHotFocus: vi.fn(),
  toIndividualHistoryEvents: vi.fn(),
  saveSurgeSnapshot: vi.fn(() => Promise.resolve()),
  saveIndividualSurgeHistory: vi.fn(() => Promise.resolve()),
  pruneSurgeHistory: vi.fn(() => Promise.resolve()),
  individualChangesHistory: vi.fn(),
}));

vi.mock('../../../electron-runtime', () => ({
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
}));

vi.mock('../market-data-scheduler', () => ({
  ensureMarketDataRuntime: mocks.ensureMarketDataRuntime,
}));

vi.mock('../market-data-sync', () => ({
  startMarketDataSync: mocks.startMarketDataSync,
}));

vi.mock('../../stock-db/market-data-store', () => ({
  listSecurities: mocks.listSecurities,
}));

vi.mock('../../stock/anomaly/surge-history-scheduler', () => ({
  ensureSurgeHistoryCapture: mocks.ensureSurgeHistoryCapture,
  isSurgeHistorySchedulerRunning: mocks.isSurgeHistorySchedulerRunning,
}));

vi.mock('../../stock-db/surge-history-store', () => ({
  clearSurgeHistoryClearMarker: vi.fn(),
  getSurgeHistoryFreshness: mocks.getSurgeHistoryFreshness,
  pruneSurgeHistory: mocks.pruneSurgeHistory,
  saveIndividualSurgeHistory: mocks.saveIndividualSurgeHistory,
  saveSurgeSnapshot: mocks.saveSurgeSnapshot,
}));

vi.mock('../../stock/anomaly/hot-focus', () => ({
  listHotFocus: mocks.listHotFocus,
  toIndividualHistoryEvents: mocks.toIndividualHistoryEvents,
}));

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    marketEvent = {
      individualChangesHistory: mocks.individualChangesHistory,
    };
  },
}));

const securities = (symbols: string[]) =>
  symbols.map((symbol) => ({
    symbol,
    name: symbol,
    exchange: 'SH' as const,
    securityType: 'stock' as const,
    status: 'listed' as const,
    isSt: false,
    source: 'test',
    updatedAt: '2026-08-11T00:00:00.000Z',
  }));

async function loadSyncSurgeHistory() {
  vi.resetModules();
  return (await import('../data-sync-handlers.js')).syncSurgeHistory;
}

async function loadStartupSync() {
  vi.resetModules();
  return (await import('../data-sync-handlers.js')).syncSurgeHistoryIfNeeded;
}

async function loadFreshnessPredicate() {
  vi.resetModules();
  return (await import('../data-sync-handlers.js')).shouldSyncSurgeHistory;
}

describe('syncSurgeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSurgeHistoryFreshness.mockResolvedValue({ recordCount: 3, latestCapturedAt: '2026-08-11T00:00:00.000Z' });
    mocks.listSecurities.mockResolvedValue(securities(['600519', '000001', '300750']));
    mocks.listHotFocus.mockResolvedValue([
      { id: 'today-600519', title: '贵州茅台 600519', code: '600519', type: 'surge' },
    ]);
    mocks.individualChangesHistory.mockImplementation(async (code: string) => {
      if (code === '000001') throw new Error('upstream unavailable');
      return { name: code, days: [] };
    });
    mocks.toIndividualHistoryEvents.mockImplementation((_history: unknown, code: string) =>
      code === '000001'
        ? []
        : [
            {
              id: `event-${code}`,
              tradeDate: '2026-08-07',
              title: code,
              code,
              type: 'surge' as const,
            },
          ],
    );
  });

  it('同步全部上市股票，而不是只同步今日热点股票', async () => {
    const syncSurgeHistory = await loadSyncSurgeHistory();

    await syncSurgeHistory();

    expect(mocks.individualChangesHistory).toHaveBeenCalledTimes(3);
    expect(mocks.individualChangesHistory.mock.calls.map(([code]) => code).sort()).toEqual([
      '000001',
      '300750',
      '600519',
    ]);
    expect(mocks.individualChangesHistory).toHaveBeenCalledWith('000001', { days: 7 });
    expect(mocks.saveIndividualSurgeHistory).toHaveBeenCalledTimes(1);
    expect(mocks.saveIndividualSurgeHistory).toHaveBeenCalledWith([
      expect.objectContaining({ code: '600519' }),
      expect.objectContaining({ code: '300750' }),
    ]);
    expect(mocks.pruneSurgeHistory).toHaveBeenCalledWith(7);
  });

  it('证券列表为空时先启动真实市场同步，再重新读取证券列表', async () => {
    const syncSurgeHistory = await loadSyncSurgeHistory();
    mocks.listSecurities.mockResolvedValueOnce([]).mockResolvedValueOnce(securities(['600519']));

    await syncSurgeHistory();

    expect(mocks.startMarketDataSync).toHaveBeenCalledWith();
    expect(mocks.individualChangesHistory).toHaveBeenCalledWith('600519', { days: 7 });
  });

  it('证券列表 bootstrap 后仍为空时暴露错误且不伪造完成结果', async () => {
    const syncSurgeHistory = await loadSyncSurgeHistory();
    mocks.listSecurities.mockResolvedValue([]);

    await expect(syncSurgeHistory()).rejects.toThrow('本地证券列表为空');

    expect(mocks.startMarketDataSync).toHaveBeenCalledWith();
    expect(mocks.individualChangesHistory).not.toHaveBeenCalled();
    expect(mocks.saveIndividualSurgeHistory).not.toHaveBeenCalled();
  });

  it('并发调用只执行一轮个股历史请求', async () => {
    const syncSurgeHistory = await loadSyncSurgeHistory();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.individualChangesHistory.mockImplementation(async (code: string) => {
      await gate;
      return { name: code, days: [] };
    });

    const first = syncSurgeHistory();
    const second = syncSurgeHistory();
    expect(first).toBe(second);
    release?.();
    await first;

    expect(mocks.individualChangesHistory).toHaveBeenCalledTimes(3);
  });

  it('启动时异动记录为空则自动同步，并启动后台采集', async () => {
    const syncSurgeHistoryIfNeeded = await loadStartupSync();
    mocks.getSurgeHistoryFreshness.mockResolvedValue({ recordCount: 0 });

    await expect(syncSurgeHistoryIfNeeded(new Date('2026-08-12T00:00:00.000Z'))).resolves.toBe(true);

    expect(mocks.ensureSurgeHistoryCapture).toHaveBeenCalledTimes(1);
    expect(mocks.individualChangesHistory).toHaveBeenCalledTimes(3);
  });

  it('启动时异动记录在一周内更新则不触发全量同步', async () => {
    const syncSurgeHistoryIfNeeded = await loadStartupSync();

    await expect(syncSurgeHistoryIfNeeded(new Date('2026-08-12T00:00:00.000Z'))).resolves.toBe(false);

    expect(mocks.ensureSurgeHistoryCapture).toHaveBeenCalledTimes(1);
    expect(mocks.individualChangesHistory).not.toHaveBeenCalled();
    expect(mocks.getAllWindows).not.toHaveBeenCalled();
  });

  it('启动时异动记录超过一周未更新则自动同步', async () => {
    const syncSurgeHistoryIfNeeded = await loadStartupSync();
    mocks.getSurgeHistoryFreshness.mockResolvedValue({
      recordCount: 10,
      latestCapturedAt: '2026-08-04T23:59:59.999Z',
    });

    await expect(syncSurgeHistoryIfNeeded(new Date('2026-08-12T00:00:00.000Z'))).resolves.toBe(true);

    expect(mocks.individualChangesHistory).toHaveBeenCalledTimes(3);
  });

  it('恰好七天的记录不会被判定为过期', async () => {
    const shouldSyncSurgeHistory = await loadFreshnessPredicate();
    const now = new Date('2026-08-12T00:00:00.000Z');

    expect(shouldSyncSurgeHistory({ recordCount: 1, latestCapturedAt: '2026-08-05T00:00:00.000Z' }, now)).toBe(false);
    expect(shouldSyncSurgeHistory({ recordCount: 1, latestCapturedAt: '2026-08-04T23:59:59.999Z' }, now)).toBe(true);
    expect(shouldSyncSurgeHistory({ recordCount: 1, latestCapturedAt: 'not-a-date' }, now)).toBe(true);
  });
});

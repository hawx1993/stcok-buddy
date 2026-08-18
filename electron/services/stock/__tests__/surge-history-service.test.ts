import type { HotFocusItem } from '../../../../src/shared/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../market-data/providers', () => ({
  isRemoteTradingDay: vi.fn(),
}));

vi.mock('../stock-client', () => ({
  listEastmoneySurgeByDate: vi.fn(),
}));

vi.mock('../shared', () => ({
  withTimeoutReject: <T>(promise: Promise<T>) => promise,
}));

vi.mock('../../stock-db/surge-history-store', () => ({
  isSurgeHistoryClearMarkerActive: vi.fn(),
  listSurgeHistory: vi.fn(),
  saveSurgeSnapshot: vi.fn(),
}));

import { isRemoteTradingDay } from '../../market-data/providers.js';
import { listEastmoneySurgeByDate } from '../stock-client.js';
import { isSurgeHistoryClearMarkerActive, listSurgeHistory, saveSurgeSnapshot } from '../../stock-db/surge-history-store.js';
import { listSurgeHistoryWithBackfill } from '../surge-history-service.js';

const mockedIsRemoteTradingDay = vi.mocked(isRemoteTradingDay);
const mockedListEastmoneySurgeByDate = vi.mocked(listEastmoneySurgeByDate);
const mockedIsSurgeHistoryClearMarkerActive = vi.mocked(isSurgeHistoryClearMarkerActive);
const mockedListSurgeHistory = vi.mocked(listSurgeHistory);
const mockedSaveSurgeSnapshot = vi.mocked(saveSurgeSnapshot);

function waitForBackground() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('异动历史服务', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsRemoteTradingDay.mockResolvedValue(false);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([]);
    mockedListEastmoneySurgeByDate.mockResolvedValue([]);
    mockedSaveSurgeSnapshot.mockResolvedValue(undefined);
  });

  it('有本地缓存时优先返回且不等待交易日校验', async () => {
    const cached = [
      {
        id: 'cached-today',
        title: '今日异动',
        code: '600519',
        name: undefined,
        time: '10:01',
        price: undefined,
        changePercent: undefined,
        turnover: undefined,
        amount: undefined,
        description: undefined,
        tag: undefined,
        type: undefined,
      },
    ];
    mockedIsRemoteTradingDay.mockResolvedValue(false);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue(cached);

    await expect(listSurgeHistoryWithBackfill('2026-07-31', 0, 20)).resolves.toEqual(cached);
    expect(mockedListSurgeHistory).toHaveBeenCalledWith('2026-07-31', 0, 20);
    expect(mockedIsRemoteTradingDay).not.toHaveBeenCalled();
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
  });

  it('右侧栏 deferred 模式在本地为空时立即返回并后台回填', async () => {
    let resolveTradingDay: (value: boolean) => void = () => {};
    const tradingDay = new Promise<boolean>((resolve) => {
      resolveTradingDay = resolve;
    });
    const remote = [
      {
        id: 'remote-2026-08-04',
        title: '贵州茅台 600519',
        code: '600519',
        time: '10:02',
        tag: '快速涨幅',
        type: 'surge' as const,
      },
    ];
    mockedIsRemoteTradingDay.mockReturnValue(tradingDay);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([]);
    mockedListEastmoneySurgeByDate.mockResolvedValue(remote);

    await expect(listSurgeHistoryWithBackfill('2026-08-04', 0, 20, { deferBackfill: true })).resolves.toEqual([]);
    expect(mockedIsRemoteTradingDay).toHaveBeenCalledWith('2026-08-04');
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();

    resolveTradingDay(true);
    await waitForBackground();
    expect(mockedListEastmoneySurgeByDate).toHaveBeenCalledWith('2026-08-04');
    expect(mockedSaveSurgeSnapshot).toHaveBeenCalledWith(remote, expect.any(Date), '2026-08-04');
  });

  it('deferred 回填在非交易日只返回空态且不请求远端', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(false);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([]);
    mockedListEastmoneySurgeByDate.mockResolvedValue([
      {
        id: 'remote-previous',
        title: '金固股份 002488',
        code: '002488',
        name: undefined,
        time: '14:38',
        price: undefined,
        changePercent: undefined,
        turnover: undefined,
        amount: undefined,
        description: undefined,
        tag: '涨停开板',
        type: undefined,
      },
    ]);

    await expect(listSurgeHistoryWithBackfill('2026-08-01', 0, 20, { deferBackfill: true })).resolves.toEqual([]);
    await waitForBackground();
    expect(mockedListSurgeHistory).toHaveBeenCalledWith('2026-08-01', 0, 20);
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
    expect(mockedSaveSurgeSnapshot).not.toHaveBeenCalled();
  });

  it('deferred 同日期并发请求只启动一次远端回填', async () => {
    let resolveRemote: (items: HotFocusItem[]) => void = () => {};
    const remote = new Promise<HotFocusItem[]>((resolve) => {
      resolveRemote = resolve;
    });
    mockedIsRemoteTradingDay.mockResolvedValue(true);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([]);
    mockedListEastmoneySurgeByDate.mockReturnValue(remote);

    await Promise.all([
      listSurgeHistoryWithBackfill('2026-08-05', 0, 20, { deferBackfill: true }),
      listSurgeHistoryWithBackfill('2026-08-05', 0, 20, { deferBackfill: true }),
    ]);
    await Promise.resolve();
    expect(mockedIsRemoteTradingDay).toHaveBeenCalledTimes(1);
    expect(mockedListEastmoneySurgeByDate).toHaveBeenCalledTimes(1);

    resolveRemote([]);
    await waitForBackground();
  });

  it('无本地缓存且非交易日不回填远端数据', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(false);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([]);
    mockedListEastmoneySurgeByDate.mockResolvedValue([
      {
        id: 'remote-previous',
        title: '金固股份 002488',
        code: '002488',
        name: undefined,
        time: '14:38',
        price: undefined,
        changePercent: undefined,
        turnover: undefined,
        amount: undefined,
        description: undefined,
        tag: '涨停开板',
        type: undefined,
      },
    ]);

    await expect(listSurgeHistoryWithBackfill('2026-08-01', 0, 20)).resolves.toEqual([]);
    expect(mockedListSurgeHistory).toHaveBeenCalledWith('2026-08-01', 0, 20);
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
    expect(mockedSaveSurgeSnapshot).not.toHaveBeenCalled();
  });

  it('返回本地缓存前过滤一万手以下的特大单', async () => {
    const cached = [
      {
        id: 'cached-invalid',
        title: '鸿仕达 920125',
        code: '920125',
        name: '鸿仕达',
        time: '11:28',
        price: '137.00',
        changePercent: '+11.98%',
        turnover: undefined,
        amount: '买入183手',
        description: '特大单买入',
        tag: '特大单买入',
        type: 'surge' as const,
      },
      {
        id: 'cached-valid',
        title: '中嘉博创 000889',
        code: '000889',
        name: '中嘉博创',
        time: '11:28',
        price: '3.93',
        changePercent: '-0.26%',
        turnover: undefined,
        amount: '买入1.02万手',
        description: '特大单买入',
        tag: '特大单买入',
        type: 'surge' as const,
      },
    ];
    mockedIsRemoteTradingDay.mockResolvedValue(true);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue(cached);

    await expect(listSurgeHistoryWithBackfill('2026-08-05', 0, 20)).resolves.toEqual([cached[1]]);
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
  });

  it('远端回填只保存并返回一万手以上的特大单', async () => {
    const remote = [
      {
        id: 'remote-invalid',
        title: '鸿仕达 920125',
        code: '920125',
        name: '鸿仕达',
        time: '11:28',
        price: '137.00',
        changePercent: '+11.98%',
        turnover: undefined,
        amount: '买入183手',
        description: '特大单买入',
        tag: '特大单买入',
        type: 'surge' as const,
      },
      {
        id: 'remote-valid',
        title: '中嘉博创 000889',
        code: '000889',
        name: '中嘉博创',
        time: '11:28',
        price: '3.93',
        changePercent: '-0.26%',
        turnover: undefined,
        amount: '买入1.02万手',
        description: '特大单买入',
        tag: '特大单买入',
        type: 'surge' as const,
      },
      {
        id: 'remote-normal',
        title: '快速涨幅',
        code: '300476',
        name: '胜宏科技',
        time: '11:27',
        price: '217.53',
        changePercent: '+7.79%',
        turnover: undefined,
        amount: undefined,
        description: '快速涨幅',
        tag: '快速涨幅',
        type: 'surge' as const,
      },
    ];
    mockedIsRemoteTradingDay.mockResolvedValue(true);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([]);
    mockedListEastmoneySurgeByDate.mockResolvedValue(remote);
    mockedSaveSurgeSnapshot.mockResolvedValue(undefined);

    await expect(listSurgeHistoryWithBackfill('2026-08-05', 0, 20)).resolves.toEqual([remote[1], remote[2]]);
    expect(mockedSaveSurgeSnapshot).toHaveBeenCalledWith([remote[1], remote[2]], expect.any(Date), '2026-08-05');
  });
});

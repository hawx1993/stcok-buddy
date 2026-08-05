import { describe, expect, it, vi } from 'vitest';

vi.mock('../../market-data/providers.js', () => ({
  isRemoteTradingDay: vi.fn(),
}));

vi.mock('../stock-client.js', () => ({
  listEastmoneySurgeByDate: vi.fn(),
}));

vi.mock('../surge-history-store.js', () => ({
  isSurgeHistoryClearMarkerActive: vi.fn(),
  listSurgeHistory: vi.fn(),
  saveSurgeSnapshot: vi.fn(),
}));

import { isRemoteTradingDay } from '../../market-data/providers.js';
import { listEastmoneySurgeByDate } from '../stock-client.js';
import { isSurgeHistoryClearMarkerActive, listSurgeHistory, saveSurgeSnapshot } from '../surge-history-store.js';
import { listSurgeHistoryWithBackfill } from '../surge-history-service.js';

const mockedIsRemoteTradingDay = vi.mocked(isRemoteTradingDay);
const mockedListEastmoneySurgeByDate = vi.mocked(listEastmoneySurgeByDate);
const mockedIsSurgeHistoryClearMarkerActive = vi.mocked(isSurgeHistoryClearMarkerActive);
const mockedListSurgeHistory = vi.mocked(listSurgeHistory);
const mockedSaveSurgeSnapshot = vi.mocked(saveSurgeSnapshot);

describe('异动历史服务', () => {
  it('非交易日今天不读取本地历史也不回填远端数据', async () => {
    mockedIsRemoteTradingDay.mockResolvedValue(false);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue([
      { id: 'cached-previous', title: '安记食品 603696', code: '603696', name: undefined, time: '14:50', price: undefined, changePercent: undefined, turnover: undefined, amount: undefined, description: undefined, tag: '封涨停板', type: undefined },
    ]);
    mockedListEastmoneySurgeByDate.mockResolvedValue([
      { id: 'remote-previous', title: '金固股份 002488', code: '002488', name: undefined, time: '14:38', price: undefined, changePercent: undefined, turnover: undefined, amount: undefined, description: undefined, tag: '涨停开板', type: undefined },
    ]);

    await expect(listSurgeHistoryWithBackfill('2026-08-01', 0, 20)).resolves.toEqual([]);
    expect(mockedListSurgeHistory).not.toHaveBeenCalled();
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
    expect(mockedSaveSurgeSnapshot).not.toHaveBeenCalled();
  });

  it('交易日仍优先返回本地缓存', async () => {
    const cached = [{ id: 'cached-today', title: '今日异动', code: '600519', name: undefined, time: '10:01', price: undefined, changePercent: undefined, turnover: undefined, amount: undefined, description: undefined, tag: undefined, type: undefined }];
    mockedIsRemoteTradingDay.mockResolvedValue(true);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue(cached);

    await expect(listSurgeHistoryWithBackfill('2026-07-31', 0, 20)).resolves.toEqual(cached);
    expect(mockedListSurgeHistory).toHaveBeenCalledWith('2026-07-31', 0, 20);
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
  });

  it('返回本地缓存前过滤一万手以下的特大单', async () => {
    const cached = [
      { id: 'cached-invalid', title: '鸿仕达 920125', code: '920125', name: '鸿仕达', time: '11:28', price: '137.00', changePercent: '+11.98%', turnover: undefined, amount: '买入183手', description: '特大单买入', tag: '特大单买入', type: 'surge' as const },
      { id: 'cached-valid', title: '中嘉博创 000889', code: '000889', name: '中嘉博创', time: '11:28', price: '3.93', changePercent: '-0.26%', turnover: undefined, amount: '买入1.02万手', description: '特大单买入', tag: '特大单买入', type: 'surge' as const },
    ];
    mockedIsRemoteTradingDay.mockResolvedValue(true);
    mockedIsSurgeHistoryClearMarkerActive.mockReturnValue(false);
    mockedListSurgeHistory.mockResolvedValue(cached);

    await expect(listSurgeHistoryWithBackfill('2026-08-05', 0, 20)).resolves.toEqual([cached[1]]);
    expect(mockedListEastmoneySurgeByDate).not.toHaveBeenCalled();
  });

  it('远端回填只保存并返回一万手以上的特大单', async () => {
    const remote = [
      { id: 'remote-invalid', title: '鸿仕达 920125', code: '920125', name: '鸿仕达', time: '11:28', price: '137.00', changePercent: '+11.98%', turnover: undefined, amount: '买入183手', description: '特大单买入', tag: '特大单买入', type: 'surge' as const },
      { id: 'remote-valid', title: '中嘉博创 000889', code: '000889', name: '中嘉博创', time: '11:28', price: '3.93', changePercent: '-0.26%', turnover: undefined, amount: '买入1.02万手', description: '特大单买入', tag: '特大单买入', type: 'surge' as const },
      { id: 'remote-normal', title: '快速涨幅', code: '300476', name: '胜宏科技', time: '11:27', price: '217.53', changePercent: '+7.79%', turnover: undefined, amount: undefined, description: '快速涨幅', tag: '快速涨幅', type: 'surge' as const },
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

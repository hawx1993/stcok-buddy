import { describe, expect, it } from 'vitest';
import { mergeDiscoverySectionSnapshot, mergeDiscoveryTradeDateNavSnapshot } from '../hooks/use-discovery-sections';

const marketSummary = {
  indices: [],
  mainFundFlow: null,
  northFundFlow: null,
  limitUp: 0,
  limitDown: 0,
  sentimentBar: 50,
  sectors: [{ code: 'BK0001', name: '半导体', changePercent: 2.1, mainNetInflow: 0 }],
  opportunityRadar: [],
  monthlyThemes: [],
  nextWeekSectors: [],
};

describe('探索页分区快照合并', () => {
  it('同一交易日保留已加载区块并合并新返回区块', () => {
    const merged = mergeDiscoverySectionSnapshot(
      {
        tradeDate: '2026-08-04',
        generatedAt: '2026-08-04T01:30:00.000Z',
        score: 62,
        tradeDates: [{ date: '2026-08-04', weekday: '星期二' }],
      },
      {
        tradeDate: '2026-08-04',
        generatedAt: '2026-08-04T01:31:00.000Z',
        marketSummary,
      },
    );

    expect(merged.score).toBe(62);
    expect(merged.marketSummary?.sectors[0]?.name).toBe('半导体');
    expect(merged.tradeDates?.[0]?.date).toBe('2026-08-04');
  });

  it('交易日变化时丢弃前一日区块，避免跨日数据混合', () => {
    const merged = mergeDiscoverySectionSnapshot(
      {
        tradeDate: '2026-08-04',
        generatedAt: '2026-08-04T01:30:00.000Z',
        marketSummary,
      },
      {
        tradeDate: '2026-08-03',
        generatedAt: '2026-08-04T01:31:00.000Z',
        score: 55,
      },
    );

    expect(merged.tradeDate).toBe('2026-08-03');
    expect(merged.score).toBe(55);
    expect(merged.marketSummary).toBeUndefined();
  });

  it('正常区块响应会清除9:30等待态', () => {
    const merged = mergeDiscoverySectionSnapshot(
      {
        tradeDate: '2026-08-04',
        generatedAt: '2026-08-04T00:30:00.000Z',
        unavailableReason: '数据9:30更新，请稍后',
      },
      {
        tradeDate: '2026-08-04',
        generatedAt: '2026-08-04T01:31:00.000Z',
        score: 60,
      },
    );

    expect(merged.unavailableReason).toBeUndefined();
  });

  it('交易日导航响应只更新日期列表，不覆盖已加载区块', () => {
    const merged = mergeDiscoveryTradeDateNavSnapshot(
      {
        tradeDate: '2026-08-03',
        generatedAt: '2026-08-03T01:30:00.000Z',
        score: 62,
        marketSummary,
      },
      {
        tradeDate: '2026-08-04',
        generatedAt: '2026-08-04T01:31:00.000Z',
        tradeDates: [
          { date: '2026-08-04', weekday: '星期二' },
          { date: '2026-08-03', weekday: '星期一' },
        ],
      },
    );

    expect(merged.tradeDate).toBe('2026-08-03');
    expect(merged.score).toBe(62);
    expect(merged.marketSummary?.sectors[0]?.name).toBe('半导体');
    expect(merged.tradeDates?.map((item) => item.date)).toEqual(['2026-08-04', '2026-08-03']);
  });
});

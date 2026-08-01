import { describe, expect, it } from 'vitest';
import type { IBoardDashboardMetric } from '../types.js';
import { selectTopBoardChangeRankings, selectTopBoardFundInflowRankings } from '../board-dashboard-rankings.js';

const baseMetric: IBoardDashboardMetric = {
  boardCode: 'BK0000',
  boardName: '样本板块',
  boardKind: 'industry',
  range: 'today',
  tradeDate: '2026-07-31',
  changePercent: null,
  maxDailyChangePercent: null,
  mainNetInflow: null,
  amount: null,
  limitUpCount: null,
  upCount: null,
  downCount: null,
  constituentCount: 0,
  upRatio: null,
  averageTurnoverRate: null,
  averageAmplitude: null,
  momentumScore: null,
  fundScore: null,
  breadthScore: null,
  leaderScore: null,
  riskScore: null,
  rawScore: null,
  heatScore: null,
  heatRank: null,
  bucket: 'potential',
  leaders: [],
  reason: '测试样本',
  source: 'merged',
  updatedAt: '2026-07-31T10:00:00.000Z',
};

function createMetric(overrides: Partial<IBoardDashboardMetric>): IBoardDashboardMetric {
  return { ...baseMetric, ...overrides };
}

describe('板块 Dashboard 榜单排序', () => {
  it('涨幅榜过滤空值并按涨幅降序取前十', () => {
    const metrics = Array.from({ length: 12 }, (_, index) =>
      createMetric({
        boardCode: `BK${String(index).padStart(4, '0')}`,
        boardName: `板块${index}`,
        changePercent: index === 3 ? null : index,
      }),
    );

    const rankings = selectTopBoardChangeRankings(metrics);

    expect(rankings).toHaveLength(10);
    expect(rankings.map((item) => item.changePercent)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 2, 1]);
  });

  it('资金流入榜过滤空值并按净流入降序取前十', () => {
    const metrics = Array.from({ length: 12 }, (_, index) =>
      createMetric({
        boardCode: `BK${String(index).padStart(4, '0')}`,
        boardName: `板块${index}`,
        mainNetInflow: index === 5 ? null : index * 100000000,
      }),
    );

    const rankings = selectTopBoardFundInflowRankings(metrics);

    expect(rankings).toHaveLength(10);
    expect(rankings.map((item) => item.mainNetInflow)).toEqual([
      1100000000,
      1000000000,
      900000000,
      800000000,
      700000000,
      600000000,
      400000000,
      300000000,
      200000000,
      100000000,
    ]);
  });

  it('空数据返回空榜单', () => {
    expect(selectTopBoardChangeRankings([])).toEqual([]);
    expect(selectTopBoardFundInflowRankings([createMetric({ boardCode: 'BK0001' })])).toEqual([]);
  });
});

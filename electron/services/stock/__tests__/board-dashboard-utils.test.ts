import { describe, expect, it } from 'vitest';
import {
  type IBoardDashboardInput,
  normalizeBoardChangePercent,
  normalizeDashboardBoardName,
  normalizeDashboardRange,
  pickBoardLeaders,
  rangeToDayLimit,
  rankBoardMetrics,
  toHalfStepScore,
} from '../board-dashboard-utils.js';

const baseInput: IBoardDashboardInput = {
  boardCode: 'BK0001',
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
  leaders: [],
  updatedAt: '2026-07-31T10:00:00.000Z',
};

function createInput(overrides: Partial<IBoardDashboardInput>): IBoardDashboardInput {
  return { ...baseInput, ...overrides };
}

describe('板块 Dashboard 区间工具', () => {
  it('空区间回到今日并映射天数', () => {
    expect(normalizeDashboardRange()).toBe('today');
    expect(rangeToDayLimit('today')).toBe(1);
    expect(rangeToDayLimit('five-days')).toBe(5);
    expect(rangeToDayLimit('twenty-days')).toBe(20);
  });

  it('过滤异常板块涨跌幅并归一化板块名称', () => {
    expect(normalizeBoardChangePercent('+1.23%')).toBe(1.23);
    expect(normalizeBoardChangePercent(95)).toBeNull();
    expect(normalizeBoardChangePercent(95, 'twenty-days')).toBe(95);
    expect(normalizeBoardChangePercent(120, 'twenty-days')).toBeNull();
    expect(normalizeDashboardBoardName('医药生物行业')).toBe('医药生物');
  });
});

describe('板块 Dashboard 热度评分', () => {
  it('按排名输出 0.5 粒度且排名越靠前越高', () => {
    const scores = [1, 2, 3, 4, 5].map((rank) => toHalfStepScore(rank, 5));
    expect(scores).toEqual([10, 8, 5.5, 3.5, 1]);
    expect(scores.every((score) => Number.isInteger(score * 2))).toBe(true);
  });

  it('没有真实指标时不生成分数和排名', () => {
    const snapshot = rankBoardMetrics([createInput({ boardCode: 'BK0001' })]);
    expect(snapshot.rankings[0]).toMatchObject({ rawScore: null, heatScore: null, heatRank: null });
  });

  it('动量和资金强且风险可控的板块进入风头正盛', () => {
    const snapshot = rankBoardMetrics([
      createInput({
        boardCode: 'BK0001',
        boardName: '强势板块',
        changePercent: 5,
        maxDailyChangePercent: 8,
        mainNetInflow: 500000000,
        amount: 2000000000,
        upRatio: 90,
        limitUpCount: 8,
        averageAmplitude: 3,
      }),
      createInput({
        boardCode: 'BK0002',
        boardName: '普通板块',
        changePercent: 0.5,
        maxDailyChangePercent: 1,
        mainNetInflow: 1000000,
        amount: 100000000,
        upRatio: 45,
        limitUpCount: 0,
        averageAmplitude: 4,
      }),
    ]);
    expect(snapshot.hot[0].boardName).toBe('强势板块');
  });

  it('资金强但涨幅未过热的板块进入潜力榜', () => {
    const snapshot = rankBoardMetrics([
      createInput({
        boardCode: 'BK0001',
        boardName: '潜力板块',
        changePercent: 0.8,
        maxDailyChangePercent: 2,
        mainNetInflow: 400000000,
        amount: 1500000000,
        upRatio: 70,
        limitUpCount: 1,
        averageAmplitude: 2,
      }),
      createInput({
        boardCode: 'BK0002',
        boardName: '弱势板块',
        changePercent: -3,
        maxDailyChangePercent: -1,
        mainNetInflow: -300000000,
        amount: 80000000,
        upRatio: 20,
        limitUpCount: 0,
        averageAmplitude: 8,
      }),
    ]);
    expect(snapshot.potential[0].boardName).toBe('潜力板块');
  });

  it('资金流出且下跌占比高的板块进入不能碰', () => {
    const snapshot = rankBoardMetrics([
      createInput({
        boardCode: 'BK0001',
        boardName: '风险板块',
        changePercent: -4,
        maxDailyChangePercent: -2,
        mainNetInflow: -600000000,
        amount: 1800000000,
        upRatio: 10,
        limitUpCount: 0,
        averageAmplitude: 9,
      }),
      createInput({
        boardCode: 'BK0002',
        boardName: '稳健板块',
        changePercent: 1,
        maxDailyChangePercent: 2,
        mainNetInflow: 100000000,
        amount: 600000000,
        upRatio: 65,
        limitUpCount: 1,
        averageAmplitude: 3,
      }),
    ]);
    expect(snapshot.avoid[0].boardName).toBe('风险板块');
  });

  it('顶部摘要卡片优先展示不同板块', () => {
    const snapshot = rankBoardMetrics([
      createInput({
        boardCode: 'BK0001',
        boardName: '全能板块',
        changePercent: 6,
        maxDailyChangePercent: 8,
        mainNetInflow: 800000000,
        amount: 2500000000,
        upRatio: 85,
        limitUpCount: 6,
        averageAmplitude: 3,
        leaders: [
          {
            code: '600001',
            name: '龙头A',
            changePercent: 9,
            mainNetInflow: 300000000,
            amount: 900000000,
            turnoverRate: 8,
            leaderScore: 82,
            reason: '主力资金净流入 / 涨幅强于板块样本 / 成交额具备辨识度',
          },
        ],
      }),
      createInput({
        boardCode: 'BK0002',
        boardName: '次强板块',
        changePercent: 3,
        maxDailyChangePercent: 5,
        mainNetInflow: 400000000,
        amount: 1500000000,
        upRatio: 70,
        limitUpCount: 2,
        averageAmplitude: 3,
        leaders: [
          {
            code: '600002',
            name: '龙头B',
            changePercent: 6,
            mainNetInflow: 150000000,
            amount: 500000000,
            turnoverRate: 8,
            leaderScore: 70,
            reason: '主力资金净流入 / 涨幅强于板块样本 / 成交额具备辨识度',
          },
        ],
      }),
    ]);
    const summaryCodes = Object.values(snapshot.summary)
      .map((metric) => metric?.boardCode)
      .filter((code): code is string => code !== undefined);
    expect(new Set(summaryCodes).size).toBeGreaterThanOrEqual(2);
  });
});

describe('板块 Dashboard 龙头股评分', () => {
  it('按资金涨幅和成交额综合选择龙头候选', () => {
    const leaders = pickBoardLeaders([
      { code: '600001', name: '资金龙头', changePercent: 4, mainNetInflow: 300000000, amount: 900000000, turnoverRate: 8 },
      { code: '600002', name: '缩量上涨', changePercent: 8, mainNetInflow: 10000000, amount: 10000000, turnoverRate: 1 },
      { code: '600003', name: '缺少数据' },
    ]);
    expect(leaders.map((item) => item.name)).toEqual(['资金龙头', '缩量上涨', '缺少数据']);
    expect(leaders[0].leaderScore).toBeGreaterThan(leaders[1].leaderScore ?? 0);
    expect(leaders[2].leaderScore).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { getOpportunityRadarMetaText, hasOpportunityRadarItems } from '../opportunity-radar';
import type { IOpportunityRadarData } from '../opportunity-radar';

describe('探索页机会雷达空态判断', () => {
  it('只有板块机会数据时显示空态', () => {
    const data: IOpportunityRadarData = {
      boards: [
        {
          code: 'BK0001',
          name: '机器人',
          ratio: 2.5,
          changePercent: 1.2,
          mainNetInflow: 3.2,
        },
      ],
      stocks: [],
    };

    expect(hasOpportunityRadarItems(data)).toBe(false);
  });

  it('股票和板块都为空时显示空态', () => {
    expect(hasOpportunityRadarItems({ boards: [], stocks: [] })).toBe(false);
    expect(hasOpportunityRadarItems()).toBe(false);
  });

  it('历史机会缺少结构化金额时仍保留真实股票机会', () => {
    expect(hasOpportunityRadarItems({
      boards: [],
      stocks: [
        {
          code: '600100',
          name: '历史机会股',
          reason: '特大单买入',
          price: 10.86,
          changePercent: 3.2,
          amount: null,
          score: 0,
        },
      ],
    })).toBe(true);
  });

  it('股票机会行需要展示代码和现价', () => {
    expect(
      getOpportunityRadarMetaText({
        code: '600100',
        name: '监控股A',
        reason: '特大单买入',
        changePercent: 3.2,
        amount: 180_000_000,
        price: 10.86,
        score: 180_000_000,
      }),
    ).toBe('600100 · 现价 10.86');
  });
});

import { describe, expect, it } from 'vitest';
import { hasOpportunityRadarItems } from '../opportunity-radar';
import type { IOpportunityRadarData } from '../opportunity-radar';

describe('探索页机会雷达空态判断', () => {
  it('只有板块机会数据时不显示空态', () => {
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

    expect(hasOpportunityRadarItems(data)).toBe(true);
  });

  it('股票和板块都为空时显示空态', () => {
    expect(hasOpportunityRadarItems({ boards: [], stocks: [] })).toBe(false);
    expect(hasOpportunityRadarItems()).toBe(false);
  });
});

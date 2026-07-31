import { describe, expect, it, vi } from 'vitest';

vi.mock('../../market-data/trade-date-resolver.js', () => ({
  resolveTradingDate: vi.fn(),
}));

vi.mock('../stock-client.js', () => ({
  getMarketPageSnapshot: vi.fn(),
  listEastmoneySurgeByDate: vi.fn(),
  listHotFocus: vi.fn(),
}));

import { scoreSentiment } from '../market-review-service.js';

describe('市场情绪评分', () => {
  it('没有情绪输入时返回 null', () => {
    expect(scoreSentiment(0, 0, 0, 0, 0)).toBeNull();
  });

  it('根据上涨家数和涨停奖励计算偏强情绪', () => {
    expect(scoreSentiment(80, 20, 50, 0, 0)).toBe(81);
  });

  it('应用跌停和炸板惩罚', () => {
    expect(scoreSentiment(50, 50, 0, 10, 20)).toBe(40);
  });

  it('混合市场分数低于 100 且弱市最低为 0', () => {
    expect(scoreSentiment(100, 1, 200, 0, 0)).toBe(99);
    expect(scoreSentiment(0, 100, 0, 100, 100)).toBe(0);
  });
});

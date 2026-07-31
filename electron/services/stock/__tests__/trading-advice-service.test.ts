import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../market-review-service.js', () => ({
  getMarketReview: vi.fn(),
}));

vi.mock('../stock-client.js', () => ({
  getBatchQuotes: vi.fn(),
  listDailyDragonTiger: vi.fn(),
  listEastmoneySurgeByDate: vi.fn(),
  listHotFocus: vi.fn(),
}));

vi.mock('../../config-store.js', () => ({
  getConfig: vi.fn(),
}));

vi.mock('../../llm/openai-compatible-client.js', () => ({
  chatWithOpenAICompatible: vi.fn(),
}));

vi.mock('../shared.js', () => ({
  sdk: {
    fundFlow: { rank: vi.fn() },
    board: { concept: { list: vi.fn() } },
  },
}));

import { reconcileAdviceLeaderStocks } from '../trading-advice-service.js';
import type { ITradingAdvice } from '../../../../src/shared/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function createAdvice(overrides: Partial<ITradingAdvice> = {}): ITradingAdvice {
  return {
    starRating: 3,
    starLabel: '中性',
    suggestedPosition: 50,
    positionReason: '观察',
    suitableStrategies: [],
    unsuitableStrategies: [],
    keySectors: [
      { name: '机器人', confidence: 'high', reason: '强势', leaderCode: 'sh600001', leaderName: '旧名称A' },
      { name: 'AI', confidence: 'medium', reason: '轮动', leaderCode: '600002', leaderName: '旧名称B' },
    ],
    marketSummary: '震荡',
    riskReminder: '波动',
    ...overrides,
  };
}

describe('交易建议龙头股校准', () => {
  it('归一化龙头代码并用真实行情名称校准', async () => {
    const quoteResolver = vi.fn().mockResolvedValue([
      { code: '600001', name: '真实A' },
      { code: 'sz600002', name: '真实B' },
    ]);

    await expect(reconcileAdviceLeaderStocks(createAdvice(), quoteResolver)).resolves.toMatchObject({
      keySectors: [
        { leaderCode: 'sh600001', leaderName: '真实A' },
        { leaderCode: '600002', leaderName: '真实B' },
      ],
    });
    expect(quoteResolver).toHaveBeenCalledWith(['600001', '600002']);
  });

  it('没有龙头代码时返回原建议', async () => {
    const advice = createAdvice({ keySectors: [{ name: '空', confidence: 'low', reason: '无', leaderCode: '', leaderName: '' }] });
    const quoteResolver = vi.fn().mockResolvedValue([]);

    await expect(reconcileAdviceLeaderStocks(advice, quoteResolver)).resolves.toBe(advice);
    expect(quoteResolver).not.toHaveBeenCalled();
  });

  it('行情解析失败时返回原建议', async () => {
    const advice = createAdvice();
    const quoteResolver = vi.fn().mockRejectedValue(new Error('quote failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(reconcileAdviceLeaderStocks(advice, quoteResolver)).resolves.toBe(advice);
    expect(warnSpy).toHaveBeenCalledWith('[trading-advice] leader quote reconcile failed', expect.any(Error));
  });
});

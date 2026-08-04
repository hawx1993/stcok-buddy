import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../discovery-service.js', () => ({
  getDiscoverySnapshot: vi.fn(),
}));

vi.mock('../market-review-service.js', () => ({
  getMarketReview: vi.fn(),
}));

vi.mock('../stock-client.js', () => ({
  getBatchQuotes: vi.fn().mockResolvedValue([]),
  listDailyDragonTiger: vi.fn(),
  listEastmoneySurgeByDate: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../config-store.js', () => ({
  getConfig: vi.fn(() => ({ model: { provider: 'deepseek', apiKey: '', baseUrl: '', model: 'test', customModel: '' } })),
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

import { chatWithOpenAICompatible } from '../../llm/openai-compatible-client.js';
import { getDiscoverySnapshot } from '../discovery-service.js';
import { getMarketReview } from '../market-review-service.js';
import { getTradingAdvice, reconcileAdviceLeaderStocks } from '../trading-advice-service.js';
import { listDailyDragonTiger, listEastmoneySurgeByDate } from '../stock-client.js';
import { sdk } from '../shared.js';
import type { ITradingAdvice } from '../../../../src/shared/types.js';

const mockedGetDiscoverySnapshot = vi.mocked(getDiscoverySnapshot);
const mockedGetMarketReview = vi.mocked(getMarketReview);
const mockedChatWithOpenAICompatible = vi.mocked(chatWithOpenAICompatible);
const mockedListDailyDragonTiger = vi.mocked(listDailyDragonTiger);
const mockedListEastmoneySurgeByDate = vi.mocked(listEastmoneySurgeByDate);
const mockedFundFlowRank = vi.mocked(sdk.fundFlow.rank);
const mockedConceptList = vi.mocked(sdk.board.concept.list);

afterEach(() => {
  vi.clearAllMocks();
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

describe('当前交易日交易建议', () => {
  it('市场复盘暂不可用但其他真实市场数据存在时仍生成建议', async () => {
    const tradeDate = new Date().toISOString().slice(0, 10);
    mockedGetMarketReview.mockRejectedValue(new Error('review failed'));
    mockedListDailyDragonTiger.mockResolvedValue([
      {
        id: `${tradeDate}-600001`,
        date: tradeDate,
        code: '600001',
        name: '龙虎榜股',
        reason: '机构专用净买入',
        changePercent: 9.9,
        netBuy: 80_000_000,
        buy: 100_000_000,
        sell: 20_000_000,
      },
    ]);
    mockedFundFlowRank.mockResolvedValue([
      {
        code: '600002',
        name: '资金股',
        price: 12,
        changePercent: 2.1,
        mainNetInflow: 120_000_000,
        mainNetInflowPercent: 3,
        superLargeNetInflow: 80_000_000,
        superLargeNetInflowPercent: 2,
        largeNetInflow: 40_000_000,
        largeNetInflowPercent: 1,
        mediumNetInflow: null,
        mediumNetInflowPercent: null,
        smallNetInflow: null,
        smallNetInflowPercent: null,
      },
    ]);
    mockedListEastmoneySurgeByDate.mockResolvedValue([
      {
        id: 'zt-1',
        title: '涨停股',
        code: '600003',
        name: '涨停股',
        tag: '封涨停板',
        description: '机器人·2连板',
      },
    ]);
    mockedConceptList.mockResolvedValue([
      {
        rank: 1,
        code: 'BK0815',
        name: '机器人',
        price: 1000,
        change: 2.6,
        changePercent: 2.6,
        totalMarketCap: 100_000_000_000,
        turnoverRate: 3.2,
        riseCount: 20,
        fallCount: 5,
        leadingStock: '涨停股',
        leadingStockChangePercent: 10,
      },
    ]);
    mockedChatWithOpenAICompatible.mockResolvedValue(JSON.stringify(createAdvice({ marketSummary: '其他数据可用' })));

    const advice = await getTradingAdvice({ tradeDate });

    expect(advice.marketSummary).toBe('其他数据可用');
    expect(mockedChatWithOpenAICompatible).toHaveBeenCalledTimes(1);
    expect(mockedChatWithOpenAICompatible.mock.calls[0][1][1].content).toContain('龙虎榜股');
    expect(mockedChatWithOpenAICompatible.mock.calls[0][1][1].content).toContain('机器人');
  });
});

describe('历史交易日交易建议', () => {
  it('按交易日读取探索页快照并缓存 AI 建议', async () => {
    mockedGetDiscoverySnapshot.mockResolvedValue({
      tradeDate: '2026-07-30',
      generatedAt: '2026-07-30T15:30:00.000Z',
      sentimentFactors: [{ label: '涨停', value: 82 }],
      hotThemes: [{ name: '机器人', score: 4, changePercent: 3.2, limitUpCount: 8, reason: '涨停扩散', leaderName: '机器人A', leaderCode: '600001' }],
      nextDayFocus: [{ category: 'theme', condition: '观察机器人是否接力', baseline: 3.2 }],
      dragonTiger: {
        inst: [{ code: '600001', name: '机器人A', changePercent: 10, netBuy: 100_000_000, reason: '机构专用' }],
        hot: [],
        first: [],
      },
    });
    mockedChatWithOpenAICompatible.mockResolvedValue(JSON.stringify(createAdvice({ marketSummary: '历史机器人强势' })));

    const first = await getTradingAdvice({ tradeDate: '2026-07-30' });
    const second = await getTradingAdvice({ tradeDate: '2026-07-30' });

    expect(first.marketSummary).toBe('历史机器人强势');
    expect(second).toBe(first);
    expect(mockedGetDiscoverySnapshot).toHaveBeenCalledTimes(1);
    expect(mockedGetDiscoverySnapshot).toHaveBeenCalledWith({
      tradeDate: '2026-07-30',
      sections: ['sentiment', 'dragon-tiger', 'hot-rotation', 'tomorrow'],
    });
    expect(mockedChatWithOpenAICompatible).toHaveBeenCalledTimes(1);
    expect(mockedChatWithOpenAICompatible.mock.calls[0][1][1].content).toContain('2026-07-30');
    expect(mockedChatWithOpenAICompatible.mock.calls[0][1][1].content).toContain('机器人');
  });

  it('历史基础数据不可用时暴露错误，不返回旧建议', async () => {
    mockedGetDiscoverySnapshot.mockResolvedValue({
      tradeDate: '2026-07-29',
      generatedAt: '2026-07-30T15:30:00.000Z',
      unavailableReason: '该交易日暂无本地历史数据，正在后台同步',
    });

    await expect(getTradingAdvice({ tradeDate: '2026-07-29' })).rejects.toThrow('该交易日暂无本地历史数据，正在后台同步');
    expect(mockedChatWithOpenAICompatible).not.toHaveBeenCalled();
  });
});

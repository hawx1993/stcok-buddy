import { describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/tool-registry.js', () => ({
  callTool: vi.fn(),
}));

vi.mock('../../llm/posthog-client.js', () => ({
  captureEvent: vi.fn(),
}));

vi.mock('../../config-store.js', () => ({
  getConfig: vi.fn(() => ({ model: {} })),
}));

import {
  extractConditionScreenerArguments,
  parseConditionScreenerArguments,
} from '../condition-screener-agent.js';

describe('条件选股命令参数解析', () => {
  it('解析预设生成的筹码筛选命令', () => {
    const result = parseConditionScreenerArguments(
      '--筹码90%集中度<15% --获利比例>50% --涨幅=0-5% --排除ST',
    );

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('；'));
    expect(result.input).toEqual({
      concentration90MaxExclusive: 15,
      profitRatioMinExclusive: 50,
      changePercentMin: 0,
      changePercentMax: 5,
      excludeST: true,
    });
  });

  it('解析总市值区间、严格上限和换手排序', () => {
    const rangeResult = parseConditionScreenerArguments(
      '--总市值=30-100亿 --换手率>8% --成交额>2亿 --排序=换手率降序',
    );
    const upperBoundResult = parseConditionScreenerArguments('--总市值<150亿');

    expect(rangeResult.valid).toBe(true);
    if (!rangeResult.valid) throw new Error(rangeResult.errors.join('；'));
    expect(rangeResult.input).toEqual({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      turnoverRateMinExclusive: 8,
      amountMinYuanExclusive: 200_000_000,
      sortBy: 'turnoverRate',
      sortOrder: 'desc',
    });
    expect(rangeResult.criteria).toEqual([
      '总市值 30–100 亿',
      '换手率 > 8%',
      '成交额 > 2 亿',
      '按换手率降序',
    ]);
    expect(upperBoundResult.valid).toBe(true);
    if (!upperBoundResult.valid) throw new Error(upperBoundResult.errors.join('；'));
    expect(upperBoundResult.input.maxTotalMarketCapYuanExclusive).toBe(15_000_000_000);
  });

  it('兼容参数名称和值之间的空格与中文逗号', () => {
    const result = parseConditionScreenerArguments(
      '--筹码90%集中度 < 15%， --获利比例 > 50% ， --涨幅 = 0-5% ， --排除ST',
    );

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('；'));
    expect(result.input.concentration90MaxExclusive).toBe(15);
    expect(result.input.profitRatioMinExclusive).toBe(50);
    expect(result.input.changePercentMax).toBe(5);
  });

  it('拒绝未知、重复和无条件命令', () => {
    const unknown = parseConditionScreenerArguments('--不存在条件>1');
    const duplicate = parseConditionScreenerArguments('--换手率>8% --换手率>6%');
    const empty = parseConditionScreenerArguments('');

    expect(unknown.valid).toBe(false);
    expect(duplicate.valid).toBe(false);
    expect(empty.valid).toBe(false);
  });

  it('从完整 slash command 中提取参数部分', () => {
    expect(extractConditionScreenerArguments('/条件选股 --今日领涨板块 --换手率>8%')).toBe(
      '--今日领涨板块 --换手率>8%',
    );
  });
});

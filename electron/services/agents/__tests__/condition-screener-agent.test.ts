import { describe, expect, it, vi } from 'vitest';

vi.mock('../tool-registry', () => ({
  callTool: vi.fn(),
}));

vi.mock('../../llm/posthog-client', () => ({
  captureEvent: vi.fn(),
}));

vi.mock('../../stock-db/config-store', () => ({
  getConfig: vi.fn(() => ({ model: {} })),
}));

import { conditionScreenerParameters } from '../../../../src/shared/condition-screener.js';
import { extractConditionScreenerArguments, parseConditionScreenerArguments } from '../condition-screener-agent.js';

describe('条件选股命令参数解析', () => {
  it('解析预设生成的筹码筛选命令', () => {
    const result = parseConditionScreenerArguments('--筹码90%集中度<15% --获利比例>50% --涨幅=0-5% --排除ST');

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
    const rangeResult = parseConditionScreenerArguments('--总市值=30-100亿 --换手率>8% --成交额>2亿 --排序=换手率降序');
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
    expect(rangeResult.criteria).toEqual(['总市值 30–100 亿', '换手率 > 8%', '成交额 > 2 亿', '按换手率降序']);
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

  it('参数弹窗中的全部示例都可执行', () => {
    for (const parameter of conditionScreenerParameters) {
      const result = parseConditionScreenerArguments(parameter.example);
      expect(result.valid, `${parameter.name}: ${parameter.example}`).toBe(true);
    }
  });

  it('解析命令格式的多市场范围', () => {
    const result = parseConditionScreenerArguments('--市场范围=沪市,深市');

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('；'));
    expect(result.input.marketScopes).toEqual(['sh', 'sz']);
    expect(result.criteria).toContain('市场范围：沪市、深市');
  });

  it('自动纠正唯一高置信度的参数名错别字', () => {
    const result = parseConditionScreenerArguments('--换首率>8%');

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('；'));
    expect(result.input.turnoverRateMinExclusive).toBe(8);
    expect(result.warnings).toContain('已将参数“--换首率>8%”识别为“--换手率>8%”。');
  });

  it('将唯一别名规范化为可执行参数', () => {
    const result = parseConditionScreenerArguments('--换手>8%');

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('；'));
    expect(result.input.turnoverRateMinExclusive).toBe(8);
    expect(result.warnings).toContain('已将参数“--换手>8%”识别为“--换手率>8%”。');
  });

  it('参数存在歧义或无法可靠猜测时询问用户', () => {
    const ambiguous = parseConditionScreenerArguments('--筹码集中度<15%');
    const unknown = parseConditionScreenerArguments('--活跃度>8%');
    const invalidValue = parseConditionScreenerArguments('--换首率=很高');

    expect(ambiguous.valid).toBe(false);
    if (ambiguous.valid) throw new Error('ambiguous parameter should fail');
    expect(ambiguous.errors.join('；')).toContain('可能是：筹码 70% 集中度');
    expect(ambiguous.errors.join('；')).toContain('筹码 90% 集中度');
    expect(ambiguous.errors.join('；')).toContain('请确认你想使用哪个参数');

    expect(unknown.valid).toBe(false);
    if (unknown.valid) throw new Error('unknown parameter should fail');
    expect(unknown.errors.join('；')).toContain('从参数弹窗选择');

    expect(invalidValue.valid).toBe(false);
    if (invalidValue.valid) throw new Error('invalid value should fail');
    expect(invalidValue.errors.join('；')).toContain('参数名称可能是“换手率”');
    expect(invalidValue.errors.join('；')).toContain('--换手率>8%');
  });

  it('纠正后的同类参数仍执行重复校验', () => {
    const result = parseConditionScreenerArguments('--换首率>8% --换手率>6%');

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('duplicate parameter should fail');
    expect(result.errors.join('；')).toContain('参数重复');
  });

  it('解析自然语言条件和新增筛选字段', () => {
    const result = parseConditionScreenerArguments(
      '帮我筛总市值 30 到 100 亿、成交额大于 2 亿、成交量超过 100 万手、换手率大于 8%、90%筹码集中度小于15%、70% 筹码集中度低于 10%、排除ST，返回前20只',
    );

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error(result.errors.join('；'));
    expect(result.input).toEqual({
      minTotalMarketCapYuan: 3_000_000_000,
      maxTotalMarketCapYuan: 10_000_000_000,
      amountMinYuanExclusive: 200_000_000,
      volumeMinExclusive: 1_000_000,
      turnoverRateMinExclusive: 8,
      concentration90MaxExclusive: 15,
      concentration70MaxExclusive: 10,
      excludeST: true,
      limit: 20,
    });
    expect(result.criteria).toContain('筹码 70% 集中度 < 10%');
    expect(result.dataRequirements).toEqual(
      expect.arrayContaining(['总市值', '成交额', '成交量', '换手率', '筹码分布']),
    );
  });

  it('支持当前会话内追加、修改和删除条件', () => {
    const first = parseConditionScreenerArguments('帮我筛总市值 30 到 100 亿、换手率大于 8%');
    expect(first.valid).toBe(true);
    if (!first.valid) throw new Error(first.errors.join('；'));

    const second = parseConditionScreenerArguments('再加上 70% 筹码集中度低于 10%', first.state);
    expect(second.valid).toBe(true);
    if (!second.valid) throw new Error(second.errors.join('；'));
    expect(second.input).toEqual(
      expect.objectContaining({
        minTotalMarketCapYuan: 3_000_000_000,
        maxTotalMarketCapYuan: 10_000_000_000,
        turnoverRateMinExclusive: 8,
        concentration70MaxExclusive: 10,
      }),
    );

    const third = parseConditionScreenerArguments('把市值改成 50 到 200 亿', second.state);
    expect(third.valid).toBe(true);
    if (!third.valid) throw new Error(third.errors.join('；'));
    expect(third.input.minTotalMarketCapYuan).toBe(5_000_000_000);
    expect(third.input.maxTotalMarketCapYuan).toBe(20_000_000_000);
    expect(third.input.concentration70MaxExclusive).toBe(10);

    const fourth = parseConditionScreenerArguments('去掉筹码条件，按成交额从高到低排序', third.state);
    expect(fourth.valid).toBe(true);
    if (!fourth.valid) throw new Error(fourth.errors.join('；'));
    expect(fourth.input.concentration70MaxExclusive).toBeUndefined();
    expect(fourth.input.sortBy).toBe('amount');
    expect(fourth.input.sortOrder).toBe('desc');
    expect(fourth.criteria.join(' · ')).not.toContain('筹码');
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

import { describe, expect, it } from 'vitest';
import {
  CONDITION_SCREENER_COMMAND,
  conditionScreenerParameters,
  conditionScreenerPresets,
  createConditionScreenerCommand,
  insertConditionScreenerParameter,
  mergeConditionScreenerCriteria,
  shouldOpenConditionScreenerParameters,
  toggleConditionScreenerPreset,
} from '../condition-screener.js';

describe('条件选股预设命令', () => {
  it('包含用户要求的五个预设', () => {
    expect(conditionScreenerPresets.map((preset) => preset.title)).toEqual([
      '小盘高换手',
      '筹码集中改善',
      '强势放量但未涨停',
      '低位活跃',
      '板块内选股',
    ]);
  });

  it('单个预设生成唯一的条件选股命令', () => {
    const command = createConditionScreenerCommand(['chip-concentration-improving']);

    expect(command).toBe('/条件选股 --筹码90%集中度<15% --获利比例>50% --涨幅=0-5% --排除ST');
    expect(command.match(/\/条件选股/g)).toHaveLength(1);
  });

  it('后选择的相同参数覆盖先前参数', () => {
    const criteria = mergeConditionScreenerCriteria(['chip-concentration-improving', 'strong-volume-not-limit-up']);
    const command = createConditionScreenerCommand(['chip-concentration-improving', 'strong-volume-not-limit-up']);

    expect(criteria.find((criterion) => criterion.key === 'change-percent')?.command).toBe('--涨幅=3-8%');
    expect(command).toContain('--涨幅=3-8%');
    expect(command).not.toContain('--涨幅=0-5%');
    expect(command.match(new RegExp(CONDITION_SCREENER_COMMAND, 'g'))).toHaveLength(1);
  });

  it('取消后按剩余选择顺序重建命令', () => {
    const selected = toggleConditionScreenerPreset(
      ['chip-concentration-improving', 'strong-volume-not-limit-up'],
      'strong-volume-not-limit-up',
    );

    expect(selected).toEqual(['chip-concentration-improving']);
    expect(createConditionScreenerCommand(selected)).toContain('--涨幅=0-5%');
  });

  it('没有已选模板时清空命令', () => {
    expect(createConditionScreenerCommand([])).toBe('');
  });

  it('完整列出带说明和可执行示例的可选参数', () => {
    expect(conditionScreenerParameters).toHaveLength(14);
    expect(new Set(conditionScreenerParameters.map((parameter) => parameter.id)).size).toBe(14);
    expect(conditionScreenerParameters.every((parameter) => parameter.description.length > 0)).toBe(true);
    expect(conditionScreenerParameters.every((parameter) => parameter.example.startsWith('--'))).toBe(true);
  });

  it('仅在条件选股命令以独立双横线结尾时打开参数面板', () => {
    expect(shouldOpenConditionScreenerParameters('/条件选股 --')).toBe(true);
    expect(shouldOpenConditionScreenerParameters('/条件选股 --成交额>5亿 --')).toBe(true);
    expect(shouldOpenConditionScreenerParameters('/条件选股 --成交额>5亿')).toBe(false);
    expect(shouldOpenConditionScreenerParameters('/超短选股 --')).toBe(false);
  });

  it('插入参数时替换尾部触发符并保留已有条件', () => {
    expect(insertConditionScreenerParameter('/条件选股 --', '--换手率>8%')).toBe('/条件选股 --换手率>8%');
    expect(insertConditionScreenerParameter('/条件选股 --成交额>5亿 --', '--换手率>8%')).toBe(
      '/条件选股 --成交额>5亿 --换手率>8%',
    );
    expect(insertConditionScreenerParameter('', '--排除ST')).toBe('/条件选股 --排除ST');
  });
});

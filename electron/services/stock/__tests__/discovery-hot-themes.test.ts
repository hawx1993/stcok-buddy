import { describe, expect, it } from 'vitest';

import { mergeHotThemeLeaders, reconcileHotThemeWithLocalBoard } from '../discovery-hot-themes.js';

describe('合并热门主题龙头', () => {
  it('保留已有龙头并截断到三个', () => {
    const theme = {
      name: '机器人',
      leaders: [
        { code: '600001', name: '一号' },
        { code: '600002', name: '二号' },
        { code: '600003', name: '三号' },
        { code: '600004', name: '四号' },
      ],
    };

    expect(mergeHotThemeLeaders(theme, undefined, [])).toEqual({
      name: '机器人',
      leaders: theme.leaders.slice(0, 3),
    });
  });

  it('从板块领涨股和候选龙头构建去重龙头列表', () => {
    const result = mergeHotThemeLeaders(
      { name: 'AI应用' },
      { topStockCode: '600001', topStockName: '龙头A' },
      [
        { code: '600001', name: '重复A' },
        { code: '600002', name: '龙头B' },
        { code: '600003', name: '龙头C' },
        { code: '600004', name: '龙头D' },
      ],
    );

    expect(result.leaders).toEqual([
      { code: '600001', name: '龙头A' },
      { code: '600002', name: '龙头B' },
      { code: '600003', name: '龙头C' },
    ]);
  });

  it('没有有效龙头来源时返回不含龙头的主题', () => {
    expect(mergeHotThemeLeaders({ name: '低空经济' }, undefined, [{ code: '', name: '空代码' }])).toEqual({ name: '低空经济' });
  });
});

describe('热门主题与本地板块校准', () => {
  it('缺少本地板块时返回 undefined', () => {
    expect(reconcileHotThemeWithLocalBoard({ name: '机器人' }, undefined, undefined)).toBeUndefined();
  });

  it('替换板块字段并格式化正向资金原因', () => {
    expect(reconcileHotThemeWithLocalBoard(
      { code: 'old', name: '旧名称', changePercent: 0, reason: null },
      { code: 'BK1234', name: '机器人板块', changePercent: 2.345 },
      { mainNetInflow: 1.26 },
    )).toEqual({
      code: 'BK1234',
      name: '机器人板块',
      changePercent: 2.345,
      reason: '板块涨跌幅 +2.35%，主力净流入 +1.3 亿。',
    });
  });

  it('格式化负涨跌幅并省略缺失资金', () => {
    const reconciled = reconcileHotThemeWithLocalBoard(
      { name: '消费', reason: null },
      { code: 'BK5678', name: '消费板块', changePercent: -0.4 },
      undefined,
    );

    expect(reconciled?.reason).toBe('板块涨跌幅 -0.40%。');
  });
});

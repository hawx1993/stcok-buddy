import { describe, expect, it } from 'vitest';

import { buildMonthlyThemesFromHistoricalPools, normalizeBoardLookupName } from '../discovery-monthly-themes.js';
import type { HotFocusItem } from '../../../../src/shared/types.js';
import type { TLocalBoardSummary } from '../discovery-service.js';

describe('板块查找名称归一化', () => {
  it('移除板块后缀、罗马层级和空白', () => {
    expect(normalizeBoardLookupName(' 半导体 行业Ⅱ板块 ')).toBe('半导体');
    expect(normalizeBoardLookupName('机器人II行业')).toBe('机器人');
    expect(normalizeBoardLookupName('新能源III板块')).toBe('新能源');
  });
});

describe('从历史涨停池构建月度主题', () => {
  const boardRows: TLocalBoardSummary[] = [
    { code: 'BK0001', name: '半导体行业Ⅱ', kind: 'industry', changePercent: 2.3, mainNetInflow: 0 },
    { code: 'BK0002', name: '机器人板块', kind: 'concept', changePercent: 1.8, mainNetInflow: 0 },
    { code: 'BK0003', name: 'AI应用', kind: 'concept', changePercent: 1.2, mainNetInflow: 0 },
  ];

  it('按归一化本地板块聚合涨停池并按成交额选择龙头', () => {
    const items: HotFocusItem[] = [
      { id: '1', title: '芯片A', code: '600001', name: '芯片A', tag: '封涨停板', description: '半导体·2连板·成交额12亿', amount: '1.5亿' },
      { id: '2', title: '芯片B', code: '600002', name: '芯片B', tag: '封涨停板', description: '半导体行业·换手3%', amount: '9000万' },
      { id: '3', title: '机器A', code: '600003', name: '机器A', tag: '封涨停板', description: '机器人·首板', amount: '3亿' },
      { id: '4', title: '炸板股', code: '600004', name: '炸板股', tag: '涨停开板', description: '机器人·开板', amount: '9亿' },
    ];

    expect(buildMonthlyThemesFromHistoricalPools([{ label: '第1周', dates: ['20260701'], items }], boardRows)).toEqual([
      { week: '第1周', theme: '半导体行业Ⅱ', leader: { code: '600001', name: '芯片A' } },
    ]);
  });

  it('次数相同时按成交额排序且龙头成交额相同时选较小代码', () => {
    const items: HotFocusItem[] = [
      { id: '1', title: 'AI-A', code: '600010', name: 'AI-A', tag: '封涨停板', description: 'AI应用·首板', amount: '1亿' },
      { id: '2', title: '机器人A', code: '600020', name: '机器人A', tag: '封涨停板', description: '机器人·首板', amount: '7000万' },
      { id: '3', title: '机器人B', code: '600019', name: '机器人B', tag: '封涨停板', description: '机器人·首板', amount: '7000万' },
    ];

    expect(buildMonthlyThemesFromHistoricalPools([{ label: '第2周', dates: ['20260708'], items }], boardRows)).toEqual([
      { week: '第2周', theme: '机器人板块', leader: { code: '600019', name: '机器人B' } },
    ]);
  });

  it('没有有效涨停板块时返回明确空主题', () => {
    const items: HotFocusItem[] = [
      { id: '1', title: '无板块', code: '600001', name: '无板块', tag: '封涨停板', description: '换手3%·成交额2亿', amount: '2亿' },
      { id: '2', title: '非涨停', code: '600002', name: '非涨停', tag: '涨停开板', description: '半导体·开板', amount: '5亿' },
    ];

    expect(buildMonthlyThemesFromHistoricalPools([{ label: '第3周', dates: ['20260715'], items }], boardRows)).toEqual([
      { week: '第3周', theme: '暂无热点数据', leader: null },
    ]);
  });
});

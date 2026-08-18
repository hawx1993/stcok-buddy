import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAStockDataFn: vi.fn(),
}));

vi.mock('../../stock/a-stock-data-runner', () => ({
  runAStockDataFn: mocks.runAStockDataFn,
}));

import {
  fetchConditionScreenerSinaBoards,
  fetchConditionScreenerSinaConstituents,
} from '../condition-screener-sina-board-provider.js';

describe('条件选股新浪板块 Provider', () => {
  beforeEach(() => {
    mocks.runAStockDataFn.mockReset();
  });

  it('映射真实行业和概念排行，并标记未覆盖的板块类别', async () => {
    mocks.runAStockDataFn.mockResolvedValue({
      rows: [
        {
          code: 'new_top',
          name: '新浪领涨行业',
          kind: 'industry',
          change_percent: 6.2,
          amount: 2_000_000_000,
          leader_code: '600001',
          leader_change_percent: 9.8,
          leader_name: '行业龙头',
        },
        {
          code: '',
          name: '无效板块',
          kind: 'concept',
          change_percent: 4,
          amount: null,
          leader_code: '',
          leader_change_percent: null,
          leader_name: '',
        },
      ],
      failed_kinds: ['concept'],
    });

    const result = await fetchConditionScreenerSinaBoards();

    expect(mocks.runAStockDataFn).toHaveBeenCalledWith('sina_board_rank', {});
    expect(result.boards).toEqual([
      expect.objectContaining({
        code: 'new_top',
        name: '新浪领涨行业',
        kind: 'industry',
        changePercent: 6.2,
        amount: 2_000_000_000,
        source: 'a-stock-data:sina',
      }),
    ]);
    expect(result.warnings).toEqual(['新浪概念板块排行暂不可用，结果未覆盖该类板块']);
  });

  it('批量映射请求范围内的真实成分股并保留部分失败提示', async () => {
    mocks.runAStockDataFn.mockResolvedValue({
      rows: [
        { board_code: 'gn_top', stock_code: 'sh600001', stock_name: '新浪概念股' },
        { board_code: 'gn_top', stock_code: '000002', stock_name: '第二只概念股' },
        { board_code: 'other', stock_code: '600003', stock_name: '非请求板块股' },
        { board_code: 'gn_top', stock_code: 'invalid', stock_name: '无效代码股' },
      ],
      failed_board_codes: ['gn_failed', 'other'],
    });

    const result = await fetchConditionScreenerSinaConstituents(['gn_top', 'gn_failed']);

    expect(mocks.runAStockDataFn).toHaveBeenCalledWith('sina_board_constituents', {
      board_codes: 'gn_top,gn_failed',
    });
    expect(result.rows).toEqual([
      expect.objectContaining({ boardCode: 'gn_top', stockCode: '600001', stockName: '新浪概念股', position: 0 }),
      expect.objectContaining({ boardCode: 'gn_top', stockCode: '000002', stockName: '第二只概念股', position: 1 }),
    ]);
    expect(result.warnings).toEqual(['新浪板块成分股暂不可用：gn_failed']);
  });
});

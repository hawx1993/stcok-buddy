import { describe, expect, it, vi } from 'vitest';

const stockSdkInstances = vi.hoisted(
  () => [] as Array<{ northbound: { summary: ReturnType<typeof vi.fn> } }>,
);

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    northbound = { summary: vi.fn() };

    constructor() {
      stockSdkInstances.push(this);
    }
  },
}));

import {
  buildNorthboundNote,
  buildNorthboundSummary,
  isNorthboundNetBuyDisclosed,
  listNorthboundFlow,
} from '../northbound-flow.js';
import type { NorthboundFlowSummary } from 'stock-sdk';

function createRow(partial: Partial<NorthboundFlowSummary>): NorthboundFlowSummary {
  return {
    date: '2026-08-03',
    type: '001',
    boardName: '沪股通',
    direction: '北向',
    status: '3',
    netBuyAmount: 0,
    netInflow: 0,
    remainAmount: 0,
    upCount: 1078,
    flatCount: 19,
    downCount: 543,
    indexCode: '000001',
    indexName: '上证指数',
    indexChangePercent: -0.59,
    ...partial,
  };
}

describe('isNorthboundNetBuyDisclosed 北向净买入披露状态', () => {
  it('北向净买额缺失或为 0（交易所已停止实时披露）时返回 false', () => {
    const rows = [
      createRow({ direction: '北向', netBuyAmount: 0, netInflow: null }),
      createRow({ boardName: '深股通', netBuyAmount: null, netInflow: 0 }),
    ];
    expect(isNorthboundNetBuyDisclosed(rows)).toBe(false);
  });

  it('北向净买额非 0 时返回 true', () => {
    expect(isNorthboundNetBuyDisclosed([createRow({ netBuyAmount: 100_000_000 })])).toBe(true);
  });
});

describe('buildNorthboundSummary 北向可用数据摘要', () => {
  it('汇总北向行涨跌家数与指数表现，可直接引用', () => {
    const rows = [
      createRow({ netBuyAmount: 0, upCount: 1078, flatCount: 19, downCount: 543, indexChangePercent: -0.59 }),
      createRow({
        boardName: '深股通',
        upCount: 1357,
        flatCount: 20,
        downCount: 498,
        indexName: '深证成指',
        indexChangePercent: -0.96,
      }),
      createRow({ boardName: '港股通(沪)', direction: '南向', upCount: null, downCount: null }),
    ];
    expect(buildNorthboundSummary(rows)).toBe(
      '沪股通：上涨 1078 家 / 持平 19 家 / 下跌 543 家，对应上证指数 -0.59%；深股通：上涨 1357 家 / 持平 20 家 / 下跌 498 家，对应深证成指 -0.96%',
    );
  });

  it('只返回北向行（南向不计入）', () => {
    expect(buildNorthboundSummary([createRow({ boardName: '港股通(沪)', direction: '南向' })])).toBe('');
  });
});

describe('buildNorthboundNote 北向披露提示', () => {
  it('北向净买额未披露时返回未披露提示，且引导使用 summary', () => {
    const rows = [createRow({ direction: '北向', netBuyAmount: 0, netInflow: null })];
    expect(buildNorthboundNote(rows)).toContain('停止实时披露');
    expect(buildNorthboundNote(rows)).toContain('summary');
  });

  it('北向净买额非 0 时返回正常披露提示', () => {
    expect(buildNorthboundNote([createRow({ netBuyAmount: 100_000_000 })])).toContain('正常披露');
  });

  it('无北向行（只有南向）时返回数据不可用提示', () => {
    expect(buildNorthboundNote([createRow({ boardName: '港股通(沪)', direction: '南向' })])).toContain('未获取到北向');
  });
});

describe('listNorthboundFlow 真实数据工具', () => {
  it('返回 summary/note/rows 及最新交易日', async () => {
    stockSdkInstances[0].northbound.summary.mockResolvedValue([
      createRow({ direction: '北向', netBuyAmount: 0 }),
      createRow({ boardName: '港股通(沪)', direction: '南向', netBuyAmount: 642_803 }),
    ]);
    const report = await listNorthboundFlow();
    expect(report.date).toBe('2026-08-03');
    expect(report.netBuyDisclosed).toBe(false);
    expect(report.summary).toContain('上涨 1078 家');
    expect(report.rows).toHaveLength(2);
    expect(report.note).toContain('停止实时披露');
  });
});

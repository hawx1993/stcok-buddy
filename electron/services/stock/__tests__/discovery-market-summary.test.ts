import { describe, expect, it } from 'vitest';

import { selectLatestMainFundFlowYi, sumNorthFundFlowYi } from '../discovery-market-summary.js';
import type { MarketFundFlow, NorthboundFlowSummary } from 'stock-sdk';

function createMarketFundFlow(date: string, mainNetInflow: number | null): MarketFundFlow {
  return {
    date,
    shClose: null,
    shChangePercent: null,
    szClose: null,
    szChangePercent: null,
    mainNetInflow,
    mainNetInflowPercent: null,
    superLargeNetInflow: null,
    superLargeNetInflowPercent: null,
    largeNetInflow: null,
    largeNetInflowPercent: null,
    mediumNetInflow: null,
    mediumNetInflowPercent: null,
    smallNetInflow: null,
    smallNetInflowPercent: null,
  };
}

function createNorthboundFlow(row: Pick<NorthboundFlowSummary, 'date' | 'direction' | 'netBuyAmount' | 'netInflow'>): NorthboundFlowSummary {
  return {
    date: row.date,
    type: 'test',
    boardName: row.direction,
    direction: row.direction,
    status: '交易中',
    netBuyAmount: row.netBuyAmount,
    netInflow: row.netInflow,
    remainAmount: null,
    upCount: null,
    flatCount: null,
    downCount: null,
    indexCode: '000001',
    indexName: '上证指数',
    indexChangePercent: null,
  };
}

describe('选择最新主力资金净流入', () => {
  it('选择指定交易日并将元换算为亿元', () => {
    const rows = [
      createMarketFundFlow('2026-07-30', 100_000_000),
      createMarketFundFlow('2026-07-31', 250_000_000),
    ];

    expect(selectLatestMainFundFlowYi(rows, '2026-07-30')).toBe(1);
  });

  it('未指定交易日时选择最新非空记录', () => {
    const rows = [
      createMarketFundFlow('2026-07-29', 300_000_000),
      createMarketFundFlow('2026-07-31', null),
      createMarketFundFlow('2026-07-30', -150_000_000),
    ];

    expect(selectLatestMainFundFlowYi(rows)).toBe(-1.5);
  });

  it('保留 0 作为有效主力资金值', () => {
    expect(selectLatestMainFundFlowYi([createMarketFundFlow('2026-07-31', 0)], '2026-07-31')).toBe(0);
  });

  it('缺失、非有限或未匹配时返回 null', () => {
    expect(selectLatestMainFundFlowYi([createMarketFundFlow('2026-07-31', Number.NaN)])).toBeNull();
    expect(selectLatestMainFundFlowYi([createMarketFundFlow('2026-07-31', null)])).toBeNull();
    expect(selectLatestMainFundFlowYi([createMarketFundFlow('2026-07-31', 1)], '2026-07-30')).toBeNull();
  });
});

describe('汇总北向资金净流入', () => {
  it('仅汇总指定交易日北向记录并换算为亿元', () => {
    const rows = [
      createNorthboundFlow({ date: '2026-07-31', direction: '北向资金', netBuyAmount: 100_000_000, netInflow: 900_000_000 }),
      createNorthboundFlow({ date: '2026-07-31', direction: 'Northbound', netBuyAmount: null, netInflow: -50_000_000 }),
      createNorthboundFlow({ date: '2026-07-31', direction: '南向资金', netBuyAmount: 999_000_000, netInflow: null }),
      createNorthboundFlow({ date: '2026-07-30', direction: '北向资金', netBuyAmount: 300_000_000, netInflow: null }),
    ];

    expect(sumNorthFundFlowYi(rows, '2026-07-31')).toBe(0.5);
  });

  it('同时存在时优先使用净买额', () => {
    const rows = [
      createNorthboundFlow({ date: '2026-07-31', direction: '北向资金', netBuyAmount: 100_000_000, netInflow: 900_000_000 }),
    ];

    expect(sumNorthFundFlowYi(rows)).toBe(1);
  });

  it('北向数值缺失、全为 0 或非有限时返回 null', () => {
    expect(sumNorthFundFlowYi([createNorthboundFlow({ date: '2026-07-31', direction: '北向资金', netBuyAmount: 0, netInflow: null })])).toBeNull();
    expect(sumNorthFundFlowYi([createNorthboundFlow({ date: '2026-07-31', direction: '北向资金', netBuyAmount: Number.NaN, netInflow: null })])).toBeNull();
    expect(sumNorthFundFlowYi([createNorthboundFlow({ date: '2026-07-31', direction: '南向资金', netBuyAmount: 100_000_000, netInflow: null })])).toBeNull();
  });
});

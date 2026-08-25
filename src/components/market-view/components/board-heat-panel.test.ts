import { describe, expect, it } from 'vitest';
import type { MarketBoardRow } from '../../../shared/types';
import { buildBoardHeatTags, formatBoardActivityLabel, rankBoards } from './board-heat-panel';

describe('BoardHeatPanel rankBoards', () => {
  it('keeps the Fuyao/Tonghuashun board order instead of re-sorting by turnover or change', () => {
    const boards: MarketBoardRow[] = [
      { code: '881169.TI', name: '贵金属', boardKind: 'industry', changePercent: -4.82, amount: 42_254_410_000, volume: 1_562_754_600, minutes: [] },
      { code: '881155.TI', name: '银行', boardKind: 'industry', changePercent: 0.2, amount: 900_000_000_000, volume: 3_783_310_600, minutes: [] },
      { code: '885728.TI', name: '人工智能', boardKind: 'concept', changePercent: 1.87, amount: 326_251_260_000, volume: 19_859_537_000, minutes: [] },
      { code: '881170.TI', name: '小金属', boardKind: 'industry', changePercent: 5.1, amount: 260_000_000_000, volume: 896_229_610, minutes: [] },
    ];

    const ranked = rankBoards(boards, 'industry');
    expect(ranked.map((item) => item.board.code)).toEqual([
      '881169.TI',
      '881155.TI',
      '881170.TI',
    ]);
    expect(ranked.map((item) => item.activityLabel)).toEqual(['量能 1562.75万手', '量能 3783.31万手', '量能 896.23万手']);
    expect(rankBoards(boards, 'concept').map((item) => item.board.code)).toEqual(['885728.TI']);
  });

  it('formats board volume from shares to lots before showing activity labels', () => {
    expect(formatBoardActivityLabel({ code: '881169.TI', name: '贵金属', volume: 1_562_754_600, amount: 42_254_410_000, minutes: [] })).toBe('量能 1562.75万手');
    expect(formatBoardActivityLabel({ code: '881155.TI', name: '银行', amount: 28_679_790_000, minutes: [] })).toBe('成交额 286.80亿');
    expect(formatBoardActivityLabel({ code: '885728.TI', name: '人工智能', minutes: [] })).toBe('活跃度 --');
  });

  it('builds board heat tags from real quotation fields', () => {
    expect(buildBoardHeatTags({ code: '881101.TI', name: '种植业与林业', changePercent: 3.29, amount: 12_673_106_400, minutes: [] }, 0)).toEqual([
      '热榜前三',
      '涨幅居前',
    ]);
    expect(buildBoardHeatTags({ code: '881102.TI', name: '养殖业', changePercent: 0.8, amount: 12_673_106_400, minutes: [] }, 5)).toEqual(['成交活跃']);
  });
});

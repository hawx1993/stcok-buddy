import { describe, expect, it, vi } from 'vitest';
import type { BoardConstituent } from '../../../shared/types';

vi.mock('../../kline-chart', () => ({ StockKlineChart: () => null }));

import { hasMainNetInflowData, sortBoardConstituents } from './board-detail-panel';

describe('BoardDetailPanel sortBoardConstituents', () => {
  it('sorts right-panel board constituents by change percent descending and keeps missing values last', () => {
    const rows: BoardConstituent[] = [
      { code: '000003', name: '缺失涨幅', changePercent: '--' },
      { code: '000002', name: '下跌股', changePercent: '-1.20%' },
      { code: '000001', name: '领涨股', changePercent: '+3.45%' },
      { code: '000004', name: '平盘股', changePercent: '0.00%' },
    ];

    expect(sortBoardConstituents(rows).map((row) => row.code)).toEqual(['000001', '000004', '000002', '000003']);
    expect(rows.map((row) => row.code)).toEqual(['000003', '000002', '000001', '000004']);
  });

  it('hides the main net inflow column when all values are missing placeholders', () => {
    const rows: BoardConstituent[] = [
      { code: '000001', name: '空值股' },
      { code: '000002', name: '占位股', mainNetInflow: '--' },
      { code: '000003', name: '空字符串股', mainNetInflow: ' ' },
    ];

    expect(hasMainNetInflowData(rows)).toBe(false);
  });

  it('shows the main net inflow column when at least one value is available', () => {
    expect(hasMainNetInflowData([{ code: '000001', name: '有效股', mainNetInflow: -125_000_000 }])).toBe(true);
    expect(hasMainNetInflowData([{ code: '000002', name: '有效字符串股', mainNetInflow: '1.25亿' }])).toBe(true);
  });
});

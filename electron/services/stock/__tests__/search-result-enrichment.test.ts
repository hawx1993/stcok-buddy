import { describe, expect, it } from 'vitest';
import { hasCompleteSearchStockMetrics, mergeSearchStockQuoteMetrics } from '../search-result-enrichment.js';

describe('搜索结果实时行情补全', () => {
  it('补齐搜索候选中缺失的实时行情指标', () => {
    const result = mergeSearchStockQuoteMetrics(
      { code: '600519', name: '贵州茅台', price: 1_420, changePercent: '-0.35%' },
      {
        code: '600519',
        name: '贵州茅台',
        price: 1_421,
        changePercent: '-0.30%',
        marketCap: '1.78万亿',
        turnoverRate: '0.32%',
      },
      '600519',
    );

    expect(result).toMatchObject({
      code: '600519',
      name: '贵州茅台',
      price: 1_420,
      changePercent: '-0.35%',
      marketCap: '1.78万亿',
      turnoverRate: '0.32%',
    });
  });

  it('仅在四项实时指标齐全时跳过补全', () => {
    expect(
      hasCompleteSearchStockMetrics({
        code: '600519',
        name: '贵州茅台',
        price: 1_420,
        changePercent: '-0.35%',
        marketCap: '1.78万亿',
        turnoverRate: '0.32%',
      }),
    ).toBe(true);
    expect(
      hasCompleteSearchStockMetrics({
        code: '600519',
        name: '贵州茅台',
        price: 1_420,
        changePercent: '-0.35%',
      }),
    ).toBe(false);
  });
});

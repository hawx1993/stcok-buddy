import { describe, expect, it } from 'vitest';

import {
  formatMoney,
  formatMoneyFromWan,
  formatNumber,
  formatPercent,
  formatPercentPoints,
  normalizeMarketCap,
  pickNumber,
  pickString,
} from '../format.js';

describe('股票服务格式化工具', () => {
  it('按指定小数位格式化数字且无效值返回占位符', () => {
    expect(formatNumber(12.345, 1)).toBe('12.3');
    expect(formatNumber('8')).toBe('8.00');
    expect(formatNumber('--')).toBe('--');
  });

  it('将小于等于 1 的比例按百分比展示并保留正负号', () => {
    expect(formatPercent(0.05)).toBe('+5.00%');
    expect(formatPercent(5)).toBe('+5.00%');
    expect(formatPercent(-0.0123)).toBe('-1.23%');
    expect(formatPercent('abc')).toBe('--');
  });

  it('按候选键选择第一个有效数字', () => {
    expect(pickNumber({ a: 'bad', b: '12.5', c: 9 }, ['a', 'b', 'c'])).toBe(12.5);
    expect(pickNumber({ a: null, b: undefined }, ['a', 'b'])).toBeUndefined();
  });

  it('按候选键选择有效字符串并支持有限数字转字符串', () => {
    expect(pickString({ a: ' ', b: 123, c: '名称' }, ['a', 'b', 'c'])).toBe('123');
    expect(pickString({ a: Number.NaN, b: '' }, ['a', 'b'])).toBeUndefined();
  });

  it('按元格式化金额并保留负号和零值', () => {
    expect(formatMoney(120_000_000)).toBe('+1.20亿');
    expect(formatMoney(-35_000)).toBe('-3.50万');
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(undefined)).toBe('--');
  });

  it('按万元格式化金额并在过亿时换算单位', () => {
    expect(formatMoneyFromWan(12_000)).toBe('+1.20亿');
    expect(formatMoneyFromWan(-35)).toBe('-35.00万');
    expect(formatMoneyFromWan('bad')).toBe('--');
  });

  it('按百分点格式化百分比且不进行比例放大', () => {
    expect(formatPercentPoints(0.05)).toBe('+0.05%');
    expect(formatPercentPoints(-1.2)).toBe('-1.20%');
  });

  it('将小于十万的市值视为亿元并换算为元', () => {
    expect(normalizeMarketCap(80)).toBe(8_000_000_000);
    expect(normalizeMarketCap(100_000)).toBe(100_000);
    expect(normalizeMarketCap(undefined)).toBeUndefined();
  });
});

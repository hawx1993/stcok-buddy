import { describe, expect, it } from 'vitest';

import { partitionValidDailyBars, validateDailyBar } from '../quality.js';
import type { DailyBarRecord } from '../types.js';

function createBar(overrides: Partial<DailyBarRecord> = {}): DailyBarRecord {
  return {
    symbol: '600001',
    tradeDate: '2026-07-31',
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 1000,
    amount: 10_000,
    adjustType: 'qfq',
    source: 'test',
    fetchedAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}

describe('日 K 数据校验', () => {
  it('接受有效日 K 数据', () => {
    expect(validateDailyBar(createBar())).toBeUndefined();
  });

  it('拒绝无效股票代码和交易日期', () => {
    expect(validateDailyBar(createBar({ symbol: '60001' }))).toBe('股票代码必须为 6 位数字');
    expect(validateDailyBar(createBar({ tradeDate: '2026-99-99' }))).toBe('交易日期无效');
  });

  it('拒绝非有限 OHLCV 数值', () => {
    expect(validateDailyBar(createBar({ open: Number.POSITIVE_INFINITY }))).toBe('open 必须是有限数字');
    expect(validateDailyBar(createBar({ volume: Number.NaN }))).toBe('volume 必须是有限数字');
  });

  it('拒绝不一致的最高价和最低价区间', () => {
    expect(validateDailyBar(createBar({ high: 8 }))).toBe('最高价低于最低价');
    expect(validateDailyBar(createBar({ high: 10.2, close: 10.5 }))).toBe('最高价低于开盘价或收盘价');
    expect(validateDailyBar(createBar({ low: 10.2, open: 10, close: 10.1 }))).toBe('最低价高于开盘价或收盘价');
  });

  it('拒绝负成交量和无效成交额', () => {
    expect(validateDailyBar(createBar({ volume: -1 }))).toBe('成交量不能为负数');
    expect(validateDailyBar(createBar({ amount: -1 }))).toBe('成交额必须是非负有限数字');
    expect(validateDailyBar(createBar({ amount: Number.NaN }))).toBe('成交额必须是非负有限数字');
  });
});

describe('日 K 数据分组', () => {
  it('按校验结果分离有效和无效数据并保留错误信息', () => {
    const valid = createBar({ symbol: '600002' });
    const invalid = createBar({ symbol: 'bad' });

    expect(partitionValidDailyBars([valid, invalid])).toEqual({
      valid: [valid],
      invalid: [{ bar: invalid, error: '股票代码必须为 6 位数字' }],
    });
  });
});

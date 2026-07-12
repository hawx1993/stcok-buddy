import type { DailyBarRecord } from './types.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function validateDailyBar(bar: DailyBarRecord): string | undefined {
  if (!/^\d{6}$/.test(bar.symbol)) return '股票代码必须为 6 位数字';
  if (!datePattern.test(bar.tradeDate) || Number.isNaN(Date.parse(`${bar.tradeDate}T00:00:00+08:00`))) return '交易日期无效';
  for (const [name, value] of Object.entries({ open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })) {
    if (!Number.isFinite(value)) return `${name} 必须是有限数字`;
  }
  if (bar.high < bar.low) return '最高价低于最低价';
  if (bar.high < bar.open || bar.high < bar.close) return '最高价低于开盘价或收盘价';
  if (bar.low > bar.open || bar.low > bar.close) return '最低价高于开盘价或收盘价';
  if (bar.volume < 0) return '成交量不能为负数';
  if (bar.amount !== undefined && (!Number.isFinite(bar.amount) || bar.amount < 0)) return '成交额必须是非负有限数字';
  return undefined;
}

export function partitionValidDailyBars(bars: DailyBarRecord[]) {
  const valid: DailyBarRecord[] = [];
  const invalid: Array<{ bar: DailyBarRecord; error: string }> = [];
  for (const bar of bars) {
    const error = validateDailyBar(bar);
    if (error) invalid.push({ bar, error });
    else valid.push(bar);
  }
  return { valid, invalid };
}

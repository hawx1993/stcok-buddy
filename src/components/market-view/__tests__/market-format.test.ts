import { describe, expect, it } from 'vitest';

import {
  formatMarketCap,
  formatMoney,
  formatPercent,
  formatSigned,
  formatVolume,
  parsePercent,
  tone,
} from '../market-format.js';

describe('市场页格式化工具', () => {
  it('负数返回 down，正数和零返回 up', () => {
    expect(tone(-1)).toBe('down');
    expect(tone('-0.01%')).toBe('down');
    expect(tone(0)).toBe('up');
    expect(tone(1)).toBe('up');
  });

  it('解析百分号字符串并在无效时返回零', () => {
    expect(parsePercent('+3.21%')).toBe(3.21);
    expect(parsePercent('-0.5%')).toBe(-0.5);
    expect(parsePercent('--')).toBe(0);
  });

  it('格式化带符号数值', () => {
    expect(formatSigned(1.234)).toBe('+1.23');
    expect(formatSigned(-1.234)).toBe('-1.23');
    expect(formatSigned('bad')).toBe('--');
  });

  it('格式化百分比并保留无效原始值', () => {
    expect(formatPercent('2.345%')).toBe('+2.35%');
    expect(formatPercent(-0.5)).toBe('-0.50%');
    expect(formatPercent(undefined)).toBe('--');
  });

  it('按手、万手、亿手格式化成交量', () => {
    expect(formatVolume(9999)).toBe('9999手');
    expect(formatVolume(12_000)).toBe('1.20万手');
    expect(formatVolume(200_000_000)).toBe('2.00亿手');
    expect(formatVolume('bad')).toBe('bad');
  });

  it('按万和亿格式化金额', () => {
    expect(formatMoney(9999)).toBe('9999');
    expect(formatMoney(12_000)).toBe('1.20万');
    expect(formatMoney(300_000_000)).toBe('3.00亿');
    expect(formatMoney(-300_000_000)).toBe('-3.00亿');
    expect(formatMoney(-12_000)).toBe('-1.20万');
    expect(formatMoney(null)).toBe('--');
  });

  it('按亿和万亿格式化总市值', () => {
    expect(formatMarketCap(8_000_000_000)).toBe('80.0亿');
    expect(formatMarketCap(1_500_000_000_000)).toBe('1.50万亿');
    expect(formatMarketCap('bad')).toBe('bad');
  });
});

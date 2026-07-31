import { describe, expect, it, vi } from 'vitest';

vi.mock('stock-sdk', () => ({
  default: class StockSDKMock {
    board = {
      industry: { name: 'industry-api' },
      concept: { name: 'concept-api' },
    };
  },
}));

vi.mock('../../market-data/market-data-store.js', () => ({
  readBoardSnapshot: vi.fn(),
  upsertMarketBoards: vi.fn(),
  writeBoardSnapshot: vi.fn(),
}));

vi.mock('../../market-data/providers.js', () => ({
  remoteMarketStatus: vi.fn(),
}));

import {
  aggregateKline,
  aggregateKlineByMonth,
  aggregateKlineByWeek,
  boardNamesMatch,
  chunk,
  compactRow,
  mergeByCode,
  normalizeAmount,
  normalizeBoardName,
  normalizeIndustryName,
  orderBoardApis,
  parseEastmoneyKline,
  parseMarketTime,
  pickStockName,
  toKlinePoint,
  toMarketBoardRow,
  toMarketQuoteRow,
} from '../shared.js';
import type { KlinePoint } from '../../../../src/shared/types.js';

function point(time: string, open: number, close: number, high: number, low: number, volume: number, amount = 0): KlinePoint {
  return { time, timestamp: parseMarketTime(time), open, close, high, low, volume, amount };
}

describe('股票服务 K 线工具', () => {
  it('按固定数量聚合 K 线并计算高低收量额', () => {
    expect(aggregateKline([
      point('2026-07-01', 10, 11, 12, 9, 100, 1000),
      point('2026-07-02', 11, 12, 13, 10, 200, 2000),
      point('2026-07-03', 12, 11, 12, 10, 300, 3000),
    ], 2)).toEqual([
      expect.objectContaining({ time: '2026-07-02', open: 10, close: 12, high: 13, low: 9, volume: 300, amount: 3000, change: 2, changePercent: 20 }),
      expect.objectContaining({ time: '2026-07-03', open: 12, close: 11, high: 12, low: 10, volume: 300, amount: 3000 }),
    ]);
  });

  it('按自然周和自然月聚合 K 线', () => {
    const rows = [
      point('2026-07-31', 10, 11, 12, 9, 100),
      point('2026-08-01', 11, 12, 13, 10, 200),
      point('2026-08-03', 12, 13, 14, 11, 300),
    ];

    expect(aggregateKlineByWeek(rows).map((item) => item.time)).toEqual(['2026-08-01', '2026-08-03']);
    expect(aggregateKlineByMonth(rows).map((item) => item.time)).toEqual(['2026-07-31', '2026-08-03']);
  });

  it('解析东财 K 线文本和市场时间', () => {
    expect(parseEastmoneyKline('2026-07-31,10,11,12,9,100,2000,0,1.2,0.1,3.4')).toEqual(expect.objectContaining({
      time: '2026-07-31', open: 10, close: 11, high: 12, low: 9, volume: 100, amount: 2000, changePercent: 1.2, change: 0.1, turnoverRate: 3.4,
    }));
    expect(parseEastmoneyKline('2026-07-31,bad,11,12,9,100,2000,0,1.2,0.1,3.4')).toBeUndefined();
    expect(parseMarketTime('202607310930')).toBe(new Date('2026-07-31T09:30:00+08:00').getTime());
    expect(parseMarketTime('bad')).toBeUndefined();
  });

  it('从中英文原始字段转换 K 线点', () => {
    expect(toKlinePoint({ 日期: '2026-07-31', 开盘价: '10', 收盘价: '11', 最高价: '12', 最低价: '9', 成交量: '100', 成交额: '2000' })).toEqual(expect.objectContaining({
      time: '2026-07-31', open: 10, close: 11, high: 12, low: 9, volume: 100, amount: 2000,
    }));
    expect(toKlinePoint({ close: 11 })).toBeUndefined();
  });
});

describe('股票服务板块和行工具', () => {
  it('按板块类型排序 SDK 接口', () => {
    expect(orderBoardApis('concept')[0]).toHaveProperty('name', 'concept-api');
    expect(orderBoardApis('industry')[0]).toHaveProperty('name', 'industry-api');
  });

  it('按代码合并记录并忽略空字段', () => {
    expect(mergeByCode([{ code: '600001', name: '旧', price: 10 }], [{ code: '600001', name: '', price: 11 }, { code: '600002', name: '新', price: 9 }])).toEqual([
      { code: '600001', name: '旧', price: 11 },
      { code: '600002', name: '新', price: 9 },
    ]);
    expect(compactRow({ a: 1, b: '', c: null, d: [], e: ['x'] })).toEqual({ a: 1, e: ['x'] });
  });

  it('归一化板块名称并判断名称匹配', () => {
    expect(normalizeBoardName('半导体行业Ⅱ 板块')).toBe('半导体');
    expect(boardNamesMatch('半导体行业Ⅱ', '半导体')).toBe(true);
    expect(boardNamesMatch('消费', '半导体')).toBe(false);
  });

  it('按指定大小切分数组', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('股票服务行情行转换', () => {
  it('转换个股行情行并归一化金额、市值和行业', () => {
    expect(toMarketQuoteRow({ f12: 'sh600001', f14: '测试股', f2: '10.5', f3: '-1.2', f5: '1000', f6: '500', f20: '80', f100: '--' })).toEqual(expect.objectContaining({
      code: '600001', name: '测试股', price: 10.5, changePercent: -1.2, volume: 1000, amount: 5_000_000, marketCap: 8_000_000_000, industry: undefined,
    }));
  });

  it('在名称无效时回退股票代码', () => {
    expect(pickStockName({ f14: '600001' }, '600001')).toBe('600001');
    expect(pickStockName({ name: '测试股' }, '600001')).toBe('测试股');
  });

  it('归一化金额和行业名称', () => {
    expect(normalizeAmount(500)).toBe(5_000_000);
    expect(normalizeAmount(2_000_000)).toBe(2_000_000);
    expect(normalizeIndustryName(' 电子 ')).toBe('电子');
    expect(normalizeIndustryName('--')).toBeUndefined();
  });

  it('转换市场板块行并记录板块类型', () => {
    expect(toMarketBoardRow({ f12: 'bk1234', f14: '机器人', f3: '2.5', kind: 'concept' })).toEqual(expect.objectContaining({
      code: 'BK1234', name: '机器人', changePercent: 2.5, minutes: [],
    }));
  });
});

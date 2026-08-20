import { describe, expect, it, vi } from 'vitest';

import {
  listHotStockHintSource,
  toShanghaiDate,
  type IHotStockHintLoaders,
  type IHotStockLimitUpItem,
} from '../hot-stock-hints-service.js';
import type { HotFocusItem } from '../types.js';

function createItems(count: number, startCode = 600000): HotFocusItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${startCode + index}`,
    title: `股票${index}`,
    code: String(startCode + index),
    name: `股票${index}`,
  }));
}

function createLimitUpItem(
  code: string,
  totalMarketValue: number | null,
  continuousBoardCount = 1,
): IHotStockLimitUpItem {
  return {
    code,
    name: `股票${code}`,
    totalMarketValue,
    continuousBoardCount,
    ztStatistics: `${continuousBoardCount}/5`,
  };
}

function previousDate(date: string) {
  const dates: Record<string, string> = {
    '2026-08-02': '2026-07-31',
    '2026-07-31': '2026-07-30',
    '2026-07-30': '2026-07-29',
    '2026-07-29': '2026-07-28',
    '2026-07-28': '2026-07-25',
  };
  const value = dates[date];
  if (!value) throw new Error(`缺少 ${date} 的上一交易日`);
  return value;
}

function createLoaders(overrides: Partial<IHotStockHintLoaders> = {}): IHotStockHintLoaders {
  return {
    isTradingDay: vi.fn().mockResolvedValue(true),
    previousTradingDay: vi.fn((date: string) => Promise.resolve(previousDate(date))),
    listCurrentHotFocus: vi.fn().mockResolvedValue(createItems(3)),
    listPreviousSurge: vi.fn().mockResolvedValue([]),
    listLimitUpPool: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('上海日期格式化', () => {
  it('按亚洲上海时区格式化日期', () => {
    expect(toShanghaiDate(new Date('2026-07-30T16:30:00.000Z'))).toBe('2026-07-31');
  });
});

describe('热门股票提示来源', () => {
  it('交易日使用当前股票热点并限制为十条', async () => {
    const loaders = createLoaders({
      listCurrentHotFocus: vi.fn().mockResolvedValue(createItems(12)),
    });

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: createItems(10),
      tradeDate: '2026-07-31',
      isPreviousTradeDay: false,
    });
    expect(loaders.isTradingDay).toHaveBeenCalledWith('2026-07-31');
    expect(loaders.listCurrentHotFocus).toHaveBeenCalledOnce();
    expect(loaders.previousTradingDay).not.toHaveBeenCalled();
    expect(loaders.listPreviousSurge).not.toHaveBeenCalled();
    expect(loaders.listLimitUpPool).not.toHaveBeenCalled();
  });

  it('交易日历查询失败时使用当日真实涨停池', async () => {
    const loaders = createLoaders({
      isTradingDay: vi.fn().mockRejectedValue(new Error('交易日历不可用')),
      listCurrentHotFocus: vi.fn().mockRejectedValue(new Error('当日热点不可用')),
      listLimitUpPool: vi.fn((date: string): Promise<IHotStockLimitUpItem[]> => Promise.resolve(
        date === '2026-07-31'
          ? [createLimitUpItem('600301', 5_000_000_000, 2)]
          : [],
      )),
    });

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: [expect.objectContaining({ code: '600301', name: '股票600301' })],
      tradeDate: '2026-07-31',
      isPreviousTradeDay: false,
    });
    expect(loaders.listCurrentHotFocus).toHaveBeenCalledOnce();
    expect(loaders.previousTradingDay).toHaveBeenCalled();
    expect(loaders.listLimitUpPool).toHaveBeenCalledWith('2026-07-31');
  });

  it('上一交易日解析失败时使用当日真实涨停池', async () => {
    const loaders = createLoaders({
      listCurrentHotFocus: vi.fn().mockResolvedValue([]),
      previousTradingDay: vi.fn().mockRejectedValue(new Error('上一交易日不可用')),
      listLimitUpPool: vi.fn((date: string): Promise<IHotStockLimitUpItem[]> => Promise.resolve(
        date === '2026-07-31'
          ? [createLimitUpItem('600302', 5_000_000_000, 2)]
          : [],
      )),
    });

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: [expect.objectContaining({ code: '600302', name: '股票600302' })],
      tradeDate: '2026-07-31',
      isPreviousTradeDay: false,
    });
    expect(loaders.previousTradingDay).toHaveBeenCalledOnce();
    expect(loaders.listLimitUpPool).toHaveBeenCalledWith('2026-07-31');
  });

  it('交易日当日只有板块代码时回退上一交易日', async () => {
    const previousItems = createItems(2, 600100);
    const loaders = createLoaders({
      listCurrentHotFocus: vi.fn().mockResolvedValue([
        { id: 'board-BK0800', title: '人工智能', code: 'BK0800', name: '人工智能' },
      ]),
      listPreviousSurge: vi.fn().mockResolvedValue(previousItems),
    });

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: previousItems,
      tradeDate: '2026-07-30',
      isPreviousTradeDay: true,
    });
    expect(loaders.listPreviousSurge).toHaveBeenCalledWith('2026-07-30');
    expect(loaders.listLimitUpPool).not.toHaveBeenCalled();
  });

  it('上一交易日为空时继续回退再上一交易日', async () => {
    const previousItems = createItems(3, 600200);
    const loaders = createLoaders({
      listCurrentHotFocus: vi.fn().mockResolvedValue([]),
      listPreviousSurge: vi.fn((date: string) => Promise.resolve(date === '2026-07-30' ? [] : previousItems)),
    });

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: previousItems,
      tradeDate: '2026-07-29',
      isPreviousTradeDay: true,
    });
    expect(loaders.listPreviousSurge).toHaveBeenNthCalledWith(1, '2026-07-30');
    expect(loaders.listPreviousSurge).toHaveBeenNthCalledWith(2, '2026-07-29');
  });

  it('当日热点失败时继续使用历史真实热点', async () => {
    const previousItems = createItems(2, 600300);
    const loaders = createLoaders({
      listCurrentHotFocus: vi.fn().mockRejectedValue(new Error('当日热点不可用')),
      listPreviousSurge: vi.fn().mockResolvedValue(previousItems),
    });

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: previousItems,
      tradeDate: '2026-07-30',
      isPreviousTradeDay: true,
    });
  });

  it('历史异动失败时继续使用真实涨停池', async () => {
    const loaders = createLoaders({
      isTradingDay: vi.fn().mockResolvedValue(false),
      listPreviousSurge: vi.fn().mockRejectedValue(new Error('历史异动不可用')),
      listLimitUpPool: vi.fn((date: string): Promise<IHotStockLimitUpItem[]> => Promise.resolve(
        date === '2026-07-31'
          ? [createLimitUpItem('600301', 5_000_000_000, 2)]
          : [],
      )),
    });

    await expect(listHotStockHintSource(new Date('2026-08-02T02:00:00.000Z'), loaders)).resolves.toMatchObject({
      isPreviousTradeDay: true,
      items: [expect.objectContaining({ code: '600301', name: '股票600301' })],
    });
    expect(loaders.listLimitUpPool).toHaveBeenCalledWith('2026-07-31');
  });

  it('两个历史交易日均为空时筛选近五个交易日的真实涨停股', async () => {
    const loaders = createLoaders({
      isTradingDay: vi.fn().mockResolvedValue(false),
      listCurrentHotFocus: vi.fn().mockResolvedValue([]),
      listPreviousSurge: vi.fn().mockResolvedValue([]),
      listLimitUpPool: vi.fn((date: string): Promise<IHotStockLimitUpItem[]> => {
        if (date === '2026-07-31') {
          return Promise.resolve([
            createLimitUpItem('600001', 20_000_000_000, 2),
            createLimitUpItem('600002', 10_000_000_000),
            createLimitUpItem('600099', 9_999_999_999, 4),
          ]);
        }
        if (date === '2026-07-30') {
          return Promise.resolve([
            createLimitUpItem('600002', 30_000_000_000, 3),
            createLimitUpItem('600003', 12_000_000_000, 3),
            createLimitUpItem('600004', 18_000_000_000),
            createLimitUpItem('600005', 16_000_000_000),
            createLimitUpItem('600006', 14_000_000_000),
          ]);
        }
        return Promise.resolve([]);
      }),
    });

    const result = await listHotStockHintSource(new Date('2026-08-02T02:00:00.000Z'), loaders);

    expect(result.tradeDate).toBeUndefined();
    expect(result.isPreviousTradeDay).toBe(true);
    expect(result.items.map((item) => item.code)).toEqual(['600099', '600001', '600002', '600003', '600004']);
    expect(result.items).toHaveLength(5);
    expect(result.items[0]?.description).toContain('2026-07-31');
    expect(result.items[0]?.description).toContain('4连板');
    expect(loaders.listLimitUpPool).toHaveBeenCalledTimes(2);
    expect(loaders.listCurrentHotFocus).not.toHaveBeenCalled();
  });

  it('所有真实来源正常但无数据时返回明确空来源', async () => {
    const loaders = createLoaders({
      isTradingDay: vi.fn().mockResolvedValue(false),
      listCurrentHotFocus: vi.fn().mockResolvedValue([]),
      listPreviousSurge: vi.fn().mockResolvedValue([]),
      listLimitUpPool: vi.fn().mockResolvedValue([]),
    });

    await expect(listHotStockHintSource(new Date('2026-08-02T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: [],
      tradeDate: '2026-07-30',
      isPreviousTradeDay: true,
    });
    expect(loaders.listLimitUpPool).toHaveBeenCalledTimes(5);
  });

  it('所有真实股票来源失败时向调用方暴露错误', async () => {
    const loaders = createLoaders({
      isTradingDay: vi.fn().mockResolvedValue(false),
      listPreviousSurge: vi.fn().mockRejectedValue(new Error('历史异动不可用')),
      listLimitUpPool: vi.fn().mockRejectedValue(new Error('stock-sdk unavailable')),
    });

    await expect(listHotStockHintSource(new Date('2026-08-02T02:00:00.000Z'), loaders)).rejects.toThrow(
      /热点数据源暂不可用：历史异动不可用；历史异动不可用；stock-sdk unavailable/,
    );
  });
});

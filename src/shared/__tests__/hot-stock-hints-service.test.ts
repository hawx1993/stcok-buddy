import { describe, expect, it, vi } from 'vitest';

import { listHotStockHintSource, toShanghaiDate } from '../hot-stock-hints-service.js';
import type { HotFocusItem } from '../types.js';
import type { IHotStockHintLoaders } from '../hot-stock-hints-service.js';

function createItems(count: number): HotFocusItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    title: `股票${index}`,
    code: String(600000 + index),
    name: `股票${index}`,
  }));
}

describe('上海日期格式化', () => {
  it('按亚洲上海时区格式化日期', () => {
    expect(toShanghaiDate(new Date('2026-07-30T16:30:00.000Z'))).toBe('2026-07-31');
  });
});

describe('热门股票提示来源', () => {
  it('交易日使用当前热点并限制为十条', async () => {
    const loaders: IHotStockHintLoaders = {
      isTradingDay: vi.fn().mockResolvedValue(true),
      previousTradingDay: vi.fn().mockResolvedValue('2026-07-30'),
      listCurrentHotFocus: vi.fn().mockResolvedValue(createItems(12)),
      listPreviousSurge: vi.fn().mockResolvedValue(createItems(12)),
    };

    await expect(listHotStockHintSource(new Date('2026-07-31T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: createItems(10),
      tradeDate: '2026-07-31',
      isPreviousTradeDay: false,
    });
    expect(loaders.isTradingDay).toHaveBeenCalledWith('2026-07-31');
    expect(loaders.listCurrentHotFocus).toHaveBeenCalledOnce();
    expect(loaders.previousTradingDay).not.toHaveBeenCalled();
    expect(loaders.listPreviousSurge).not.toHaveBeenCalled();
  });

  it('非交易日使用上一交易日异动并限制为十条', async () => {
    const previousItems = createItems(11);
    const loaders: IHotStockHintLoaders = {
      isTradingDay: vi.fn().mockResolvedValue(false),
      previousTradingDay: vi.fn().mockResolvedValue('2026-07-30'),
      listCurrentHotFocus: vi.fn().mockResolvedValue(createItems(3)),
      listPreviousSurge: vi.fn().mockResolvedValue(previousItems),
    };

    await expect(listHotStockHintSource(new Date('2026-08-02T02:00:00.000Z'), loaders)).resolves.toEqual({
      items: previousItems.slice(0, 10),
      tradeDate: '2026-07-30',
      isPreviousTradeDay: true,
    });
    expect(loaders.previousTradingDay).toHaveBeenCalledWith('2026-08-02');
    expect(loaders.listPreviousSurge).toHaveBeenCalledWith('2026-07-30');
    expect(loaders.listCurrentHotFocus).not.toHaveBeenCalled();
  });
});
